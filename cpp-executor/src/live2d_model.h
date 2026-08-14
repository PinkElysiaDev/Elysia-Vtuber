#pragma once

#include <d3d11.h>
#include <string>
#include <unordered_map>
#include <vector>

#include <CubismFramework.hpp>
#include <ICubismModelSetting.hpp>
#include <Math/CubismMatrix44.hpp>
#include <Model/CubismUserModel.hpp>
#include <Type/csmMap.hpp>
#include <Type/csmString.hpp>
#include <Type/csmVector.hpp>
#include <nlohmann/json.hpp>

namespace vtuber {

class Live2DModel : public Csm::CubismUserModel {
 public:
  Live2DModel();
  ~Live2DModel() override;

  bool Load(const std::string& model3Json, ID3D11Device* device, int width, int height);
  void Unload();
  void Resize(int width, int height);
  void Update(float deltaSeconds);
  void Draw(int width, int height);

  bool SetExpression(const std::string& name);
  bool ResetExpression();
  bool StartMotion(const std::string& group, int index);
  void SetTransform(float scale, float x, float y);

  nlohmann::json Status() const;
  nlohmann::json MotionDetails() const;
  std::vector<std::string> ExpressionNames() const;
  std::vector<std::string> MotionGroups() const;

  bool loaded() const { return loaded_; }
  const std::string& path() const { return modelPath_; }

 private:
  bool SetupModel();
  bool SetupTextures(ID3D11Device* device);
  void ReleaseTextures();
  void PreloadMotions();

  Csm::ICubismModelSetting* setting_ = nullptr;
  std::string modelDir_;
  std::string modelPath_;
  std::unordered_map<std::string, Csm::ACubismMotion*> expressions_;
  std::unordered_map<std::string, Csm::ACubismMotion*> motions_;
  Csm::csmVector<Csm::CubismIdHandle> eyeBlinkIds_;
  Csm::csmVector<Csm::CubismIdHandle> lipSyncIds_;
  std::vector<ID3D11ShaderResourceView*> textures_;
  float extraScale_ = 1.0f;
  float extraX_ = 0.0f;
  float extraY_ = 0.0f;
  std::string currentExpression_;
  std::string lastMotionGroup_;
  int lastMotionIndex_ = -1;
  bool loaded_ = false;
};

}  // namespace vtuber
