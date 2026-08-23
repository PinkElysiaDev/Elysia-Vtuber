#include "live2d_model.h"

#include "platform.h"
#include "wic_texture.h"

#include <CubismDefaultParameterId.hpp>
#include <CubismModelSettingJson.hpp>
#include <Id/CubismIdManager.hpp>
#include <Motion/CubismMotion.hpp>
#include <Rendering/D3D11/CubismRenderer_D3D11.hpp>
#include <Utils/CubismString.hpp>

using namespace Live2D::Cubism::Framework;
using namespace Live2D::Cubism::Framework::DefaultParameterId;

namespace vtuber {

Live2DModel::Live2DModel() {
  LogLine("[live2d] ctor");
}

Live2DModel::~Live2DModel() {
  Unload();
}

bool Live2DModel::Load(const std::string& model3Json, ID3D11Device* device, int width, int height) {
  LogLine("[live2d] Load enter");
  Unload();
  LogLine("[live2d] Unload done");
  modelPath_ = ResolvePath(model3Json);
  modelDir_ = DirName(modelPath_);
  if (!modelDir_.empty() && modelDir_.back() != '/' && modelDir_.back() != '\\') {
    modelDir_ += '/';
  }
  LogLine(std::string("[live2d] load ") + modelPath_);

  FileBytes json = LoadFile(modelPath_);
  if (json.empty()) {
    LogLine(std::string("[live2d] failed to read ") + modelPath_);
    return false;
  }
  LogLine("[live2d] model3.json ok");

  setting_ = new CubismModelSettingJson(json.ptr(), json.size());
  LogLine("[live2d] SetupModel");
  if (!SetupModel()) {
    LogLine("[live2d] SetupModel failed");
    Unload();
    return false;
  }
  LogLine("[live2d] CreateRenderer");
  CreateRenderer(static_cast<csmUint32>(width), static_cast<csmUint32>(height));
  LogLine("[live2d] SetupTextures");
  if (!SetupTextures(device)) {
    LogLine("[live2d] SetupTextures failed");
    Unload();
    return false;
  }

  loaded_ = true;
  LogLine(std::string("[live2d] loaded ") + modelPath_);
  return true;
}

bool Live2DModel::SetupModel() {
  _updating = true;
  _initialized = false;

  FileBytes buffer;
  const char* moc = setting_->GetModelFileName();
  if (!moc || moc[0] == '\0') return false;

  LogLine(std::string("[live2d] moc=") + moc);
  buffer = LoadFile(JoinPath(modelDir_, moc));
  if (buffer.empty()) return false;
  LoadModel(buffer.ptr(), buffer.size());
  if (!_model) return false;
  LogLine("[live2d] moc loaded");

  for (csmInt32 i = 0; i < setting_->GetExpressionCount(); ++i) {
    const std::string name = setting_->GetExpressionName(i);
    buffer = LoadFile(JoinPath(modelDir_, setting_->GetExpressionFileName(i)));
    if (buffer.empty()) continue;
    ACubismMotion* motion = LoadExpression(buffer.ptr(), buffer.size(), name.c_str());
    if (motion) expressions_[name] = motion;
  }

  if (setting_->GetPhysicsFileName() && setting_->GetPhysicsFileName()[0] != '\0') {
    buffer = LoadFile(JoinPath(modelDir_, setting_->GetPhysicsFileName()));
    if (!buffer.empty()) LoadPhysics(buffer.ptr(), buffer.size());
  }

  if (setting_->GetPoseFileName() && setting_->GetPoseFileName()[0] != '\0') {
    buffer = LoadFile(JoinPath(modelDir_, setting_->GetPoseFileName()));
    if (!buffer.empty()) LoadPose(buffer.ptr(), buffer.size());
  }

  if (setting_->GetEyeBlinkParameterCount() > 0) {
    _eyeBlink = CubismEyeBlink::Create(setting_);
  }

  _breath = CubismBreath::Create();
  csmVector<CubismBreath::BreathParameterData> breaths;
  breaths.PushBack(CubismBreath::BreathParameterData(CubismFramework::GetIdManager()->GetId(ParamAngleX), 0.0f, 15.0f, 6.5345f, 0.5f));
  breaths.PushBack(CubismBreath::BreathParameterData(CubismFramework::GetIdManager()->GetId(ParamAngleY), 0.0f, 8.0f, 3.5345f, 0.5f));
  breaths.PushBack(CubismBreath::BreathParameterData(CubismFramework::GetIdManager()->GetId(ParamAngleZ), 0.0f, 10.0f, 5.5345f, 0.5f));
  breaths.PushBack(CubismBreath::BreathParameterData(CubismFramework::GetIdManager()->GetId(ParamBodyAngleX), 0.0f, 4.0f, 15.5345f, 0.5f));
  breaths.PushBack(CubismBreath::BreathParameterData(CubismFramework::GetIdManager()->GetId(ParamBreath), 0.5f, 0.5f, 3.2345f, 0.5f));
  _breath->SetParameters(breaths);

  if (setting_->GetUserDataFile() && setting_->GetUserDataFile()[0] != '\0') {
    buffer = LoadFile(JoinPath(modelDir_, setting_->GetUserDataFile()));
    if (!buffer.empty()) LoadUserData(buffer.ptr(), buffer.size());
  }

  for (csmInt32 i = 0; i < setting_->GetEyeBlinkParameterCount(); ++i) {
    eyeBlinkIds_.PushBack(setting_->GetEyeBlinkParameterId(i));
  }
  for (csmInt32 i = 0; i < setting_->GetLipSyncParameterCount(); ++i) {
    lipSyncIds_.PushBack(setting_->GetLipSyncParameterId(i));
  }

  csmMap<csmString, csmFloat32> layout;
  setting_->GetLayoutMap(layout);
  if (_modelMatrix) _modelMatrix->SetupFromLayout(layout);

  _model->SaveParameters();
  LogLine("[live2d] PreloadMotions");
  PreloadMotions();
  _motionManager->StopAllMotions();

  _updating = false;
  _initialized = true;
  return true;
}

void Live2DModel::PreloadMotions() {
  for (csmInt32 g = 0; g < setting_->GetMotionGroupCount(); ++g) {
    const char* group = setting_->GetMotionGroupName(g);
    const csmInt32 count = setting_->GetMotionCount(group);
    for (csmInt32 i = 0; i < count; ++i) {
      const std::string key = std::string(group) + "_" + std::to_string(i);
      FileBytes buffer = LoadFile(JoinPath(modelDir_, setting_->GetMotionFileName(group, i)));
      if (buffer.empty()) continue;
      auto* motion = static_cast<CubismMotion*>(LoadMotion(buffer.ptr(), buffer.size(), key.c_str(), NULL, NULL, setting_, group, i));
      if (!motion) continue;
      motion->SetEffectIds(eyeBlinkIds_, lipSyncIds_);
      motions_[key] = motion;
    }
  }
}

bool Live2DModel::SetupTextures(ID3D11Device* device) {
  auto* renderer = GetRenderer<Rendering::CubismRenderer_D3D11>();
  if (!renderer) {
    LogLine("[live2d] renderer missing");
    return false;
  }
  renderer->IsPremultipliedAlpha(false);

  const csmInt32 count = setting_->GetTextureCount();
  LogLine(std::string("[live2d] textures=") + std::to_string(count));
  for (csmInt32 i = 0; i < count; ++i) {
    const char* name = setting_->GetTextureFileName(i);
    if (!name || name[0] == '\0') continue;
    const std::string path = JoinPath(modelDir_, name);
    LogLine(std::string("[live2d] texture ") + path);
    ID3D11ShaderResourceView* view = nullptr;
    if (!LoadPngTexture(device, path, &view) || !view) {
      LogLine(std::string("[live2d] texture failed: ") + name);
      return false;
    }
    textures_.push_back(view);
    renderer->BindTexture(static_cast<csmUint32>(i), view);
    LogLine(std::string("[live2d] bound ") + name);
  }
  return true;
}

void Live2DModel::ReleaseTextures() {
  for (auto* view : textures_) {
    if (view) view->Release();
  }
  textures_.clear();
}

void Live2DModel::Unload() {
  loaded_ = false;
  if (_motionManager) _motionManager->StopAllMotions();
  if (_expressionManager) _expressionManager->StopAllMotions();
  DeleteRenderer();
  ReleaseTextures();
  for (auto& [_, motion] : motions_) ACubismMotion::Delete(motion);
  for (auto& [_, motion] : expressions_) ACubismMotion::Delete(motion);
  for (auto& [_, motion] : extraMotions_) ACubismMotion::Delete(motion);
  motions_.clear();
  expressions_.clear();
  extraMotions_.clear();
  eyeBlinkIds_.Clear();
  lipSyncIds_.Clear();
  delete setting_;
  setting_ = nullptr;
  modelPath_.clear();
  modelDir_.clear();
  currentExpression_.clear();
  lastMotionGroup_.clear();
  lastMotionName_.clear();
  lastMotionIndex_ = -1;
}

void Live2DModel::Resize(int width, int height) {
  if (!loaded_ || width <= 0 || height <= 0) return;
  SetRenderTargetSize(static_cast<csmUint32>(width), static_cast<csmUint32>(height));
}

void Live2DModel::Update(float deltaSeconds) {
  if (!loaded_ || !_model) return;

  _model->LoadParameters();
  // 待机动作由后端按注册配置调度（随机/顺序/间隔），此处不再硬编码重启 Idle_0
  _motionManager->UpdateMotion(_model, deltaSeconds);
  _model->SaveParameters();

  if (_expressionManager) _expressionManager->UpdateMotion(_model, deltaSeconds);
  if (_eyeBlink) _eyeBlink->UpdateParameters(_model, deltaSeconds);
  if (_breath) _breath->UpdateParameters(_model, deltaSeconds);
  if (_physics) _physics->Evaluate(_model, deltaSeconds);
  if (_pose) _pose->UpdateParameters(_model, deltaSeconds);
  _model->Update();
}

void Live2DModel::Draw(int width, int height) {
  auto* renderer = GetRenderer<Rendering::CubismRenderer_D3D11>();
  if (!loaded_ || !_model || !renderer) return;

  CubismMatrix44 projection;
  if (width > height) {
    const float ratio = static_cast<float>(width) / static_cast<float>(height);
    projection.Scale(1.0f / ratio, 1.0f);
  } else {
    const float ratio = static_cast<float>(height) / static_cast<float>(width);
    projection.Scale(1.0f, 1.0f / ratio);
  }
  projection.ScaleRelative(extraScale_, extraScale_);
  projection.TranslateRelative(extraX_, extraY_);
  projection.MultiplyByMatrix(_modelMatrix);
  renderer->SetMvpMatrix(&projection);
  renderer->DrawModel();
  CacheProjection(projection, width, height);
}

void Live2DModel::CacheProjection(const Csm::CubismMatrix44& m, int width, int height) {
  projectionCache_ = m;
  projWidth_ = width;
  projHeight_ = height;
}

bool Live2DModel::GetPixelBounds(int& x, int& y, int& w, int& h) const {
  if (!loaded_ || !_model || projWidth_ <= 0 || projHeight_ <= 0) return false;
  const float cw = _model->GetCanvasWidth() / 2.0f;
  const float ch = _model->GetCanvasHeight() / 2.0f;
  if (cw <= 0.0f || ch <= 0.0f) return false;
  CubismMatrix44 proj = projectionCache_;  // GetArray 非 const，非 const 拷贝后使用
  const float* a = proj.GetArray();
  float minX = 1e9f, maxX = -1e9f, minY = 1e9f, maxY = -1e9f;
  const float corners[4][2] = {{-cw, -ch}, {cw, -ch}, {-cw, ch}, {cw, ch}};
  for (const auto& c : corners) {
    // CubismMatrix44 列主序、平移在 [12]/[13]
    const float cx = a[0] * c[0] + a[4] * c[1] + a[12];
    const float cy = a[1] * c[0] + a[5] * c[1] + a[13];
    if (cx < minX) minX = cx;
    if (cx > maxX) maxX = cx;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  // clip 空间 → 像素（Y 翻转），并夹取到窗口内
  auto toPx = [](float v, int max) { return static_cast<int>(v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v) * max); };
  const int left = toPx((minX + 1.0f) / 2.0f, projWidth_);
  const int right = toPx((maxX + 1.0f) / 2.0f, projWidth_);
  const int top = toPx((1.0f - maxY) / 2.0f, projHeight_);
  const int bottom = toPx((1.0f - minY) / 2.0f, projHeight_);
  if (right <= left || bottom <= top) return false;
  x = left;
  y = top;
  w = right - left;
  h = bottom - top;
  return true;
}

bool Live2DModel::SetExpression(const std::string& name) {
  if (name.empty()) return ResetExpression();
  auto it = expressions_.find(name);
  if (it == expressions_.end() || !_expressionManager) return false;
  _expressionManager->StartMotion(it->second, false);
  currentExpression_ = name;
  return true;
}

bool Live2DModel::ResetExpression() {
  if (!_expressionManager) return false;
  _expressionManager->StopAllMotions();
  currentExpression_.clear();
  return true;
}

bool Live2DModel::StartMotion(const std::string& group, int index) {
  if (!setting_ || !_motionManager) return false;
  if (index < 0 || index >= setting_->GetMotionCount(group.c_str())) return false;
  const std::string key = group + "_" + std::to_string(index);
  auto it = motions_.find(key);
  if (it == motions_.end()) return false;
  _motionManager->StartMotionPriority(it->second, false, 3);
  lastMotionGroup_ = group;
  lastMotionIndex_ = index;
  lastMotionName_.clear();
  return true;
}

bool Live2DModel::StartMotionByName(const std::string& name) {
  if (!_motionManager) return false;
  auto it = extraMotions_.find(name);
  if (it == extraMotions_.end()) return false;
  _motionManager->StartMotionPriority(it->second, false, 3);
  lastMotionGroup_ = "Extra";
  lastMotionName_ = name;
  lastMotionIndex_ = -1;
  return true;
}

bool Live2DModel::LoadExtra(const nlohmann::json& params) {
  if (!loaded_) return false;
  int loadedCount = 0;
  if (params.contains("expressions") && params["expressions"].is_array()) {
    for (const auto& item : params["expressions"]) {
      const std::string name = item.value("name", "");
      const std::string file = item.value("file", "");
      if (name.empty() || file.empty()) continue;
      FileBytes buffer = LoadFile(JoinPath(modelDir_, file));
      if (buffer.empty()) {
        LogLine(std::string("[live2d] extra expression missing: ") + file);
        continue;
      }
      auto* motion = LoadExpression(buffer.ptr(), buffer.size(), name.c_str());
      if (!motion) continue;
      // 同名覆盖（重复注入）
      auto it = expressions_.find(name);
      if (it != expressions_.end()) ACubismMotion::Delete(it->second);
      expressions_[name] = motion;
      ++loadedCount;
    }
  }
  if (params.contains("motions") && params["motions"].is_array()) {
    for (const auto& item : params["motions"]) {
      const std::string name = item.value("name", "");
      const std::string file = item.value("file", "");
      if (name.empty() || file.empty()) continue;
      FileBytes buffer = LoadFile(JoinPath(modelDir_, file));
      if (buffer.empty()) {
        LogLine(std::string("[live2d] extra motion missing: ") + file);
        continue;
      }
      auto* motion = static_cast<CubismMotion*>(LoadMotion(buffer.ptr(), buffer.size(), name.c_str(), NULL, NULL, nullptr, nullptr, -1));
      if (!motion) continue;
      motion->SetEffectIds(eyeBlinkIds_, lipSyncIds_);
      auto it = extraMotions_.find(name);
      if (it != extraMotions_.end()) ACubismMotion::Delete(it->second);
      extraMotions_[name] = motion;
      ++loadedCount;
    }
  }
  LogLine("[live2d] loadExtra loaded=" + std::to_string(loadedCount));
  return true;
}

void Live2DModel::SetTransform(float scale, float x, float y) {
  extraScale_ = scale <= 0.0f ? 1.0f : scale;
  extraX_ = x;
  extraY_ = y;
}

nlohmann::json Live2DModel::Status() const {
  return {
      {"loaded", loaded_},
      {"path", modelPath_},
      {"scale", extraScale_},
      {"x", extraX_},
      {"y", extraY_},
      {"expression", currentExpression_},
      {"lastMotion", {
          {"group", lastMotionGroup_},
          {"index", lastMotionIndex_},
          {"name", lastMotionName_},
      }},
      {"motionActive", motionActive()},
      {"expressions", ExpressionNames()},
      {"motions", MotionDetails()},
      {"namedMotions", NamedMotionList()},
      {"groups", MotionGroups()},
  };
}

nlohmann::json Live2DModel::MotionDetails() const {
  nlohmann::json arr = nlohmann::json::array();
  if (!setting_) return arr;
  for (csmInt32 i = 0; i < setting_->GetMotionGroupCount(); ++i) {
    const char* group = setting_->GetMotionGroupName(i);
    arr.push_back({
        {"group", group ? group : ""},
        {"count", setting_->GetMotionCount(group)},
    });
  }
  return arr;
}

std::vector<std::string> Live2DModel::ExpressionNames() const {
  std::vector<std::string> names;
  names.reserve(expressions_.size());
  for (const auto& [name, _] : expressions_) names.push_back(name);
  return names;
}

std::vector<std::string> Live2DModel::MotionGroups() const {
  std::vector<std::string> groups;
  if (!setting_) return groups;
  for (csmInt32 i = 0; i < setting_->GetMotionGroupCount(); ++i) {
    groups.emplace_back(setting_->GetMotionGroupName(i));
  }
  return groups;
}

std::vector<std::string> Live2DModel::NamedMotionList() const {
  std::vector<std::string> names;
  names.reserve(extraMotions_.size());
  for (const auto& [name, _] : extraMotions_) names.push_back(name);
  return names;
}

}  // namespace vtuber
