#include "audio_player.h"

#include "platform.h"

#define INITGUID
#include <atomic>
#include <cmath>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <fstream>
#include <vector>
#include <winhttp.h>

#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "winhttp.lib")
#pragma comment(lib, "ole32.lib")

namespace vtuber {
namespace {

std::wstring TempAudioPath() {
  wchar_t dir[MAX_PATH]{};
  GetTempPathW(MAX_PATH, dir);
  wchar_t path[MAX_PATH]{};
  GetTempFileNameW(dir, L"vtb", 0, path);
  return path;
}

bool DownloadToFile(const std::string& url, const nlohmann::json& headers, const std::wstring& dest) {
  URL_COMPONENTSW parts{};
  parts.dwStructSize = sizeof(parts);
  wchar_t host[256]{};
  wchar_t path[2048]{};
  wchar_t extra[1024]{};
  parts.lpszHostName = host;
  parts.dwHostNameLength = 256;
  parts.lpszUrlPath = path;
  parts.dwUrlPathLength = 2048;
  parts.lpszExtraInfo = extra;
  parts.dwExtraInfoLength = 1024;
  const std::wstring wideUrl = Utf8ToWide(url);
  if (!WinHttpCrackUrl(wideUrl.c_str(), 0, 0, &parts)) return false;

  HINTERNET session = WinHttpOpen(L"vtuber-executor/0.2", WINHTTP_ACCESS_TYPE_DEFAULT_PROXY,
                                  WINHTTP_NO_PROXY_NAME, WINHTTP_NO_PROXY_BYPASS, 0);
  if (!session) return false;
  HINTERNET connect = WinHttpConnect(session, host, parts.nPort, 0);
  if (!connect) {
    WinHttpCloseHandle(session);
    return false;
  }
  std::wstring object = path;
  object += extra;
  DWORD flags = (parts.nScheme == INTERNET_SCHEME_HTTPS) ? WINHTTP_FLAG_SECURE : 0;
  HINTERNET request = WinHttpOpenRequest(connect, L"GET", object.c_str(), nullptr,
                                         WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES, flags);
  if (!request) {
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return false;
  }

  std::wstring extraHeaders;
  if (headers.is_object()) {
    for (auto it = headers.begin(); it != headers.end(); ++it) {
      extraHeaders += Utf8ToWide(it.key());
      extraHeaders += L": ";
      extraHeaders += Utf8ToWide(it.value().is_string() ? it.value().get<std::string>() : it.value().dump());
      extraHeaders += L"\r\n";
    }
  }
  if (!extraHeaders.empty()) {
    WinHttpAddRequestHeaders(request, extraHeaders.c_str(), static_cast<DWORD>(-1), WINHTTP_ADDREQ_FLAG_ADD);
  }
  const bool okSend = WinHttpSendRequest(request, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0)
                      && WinHttpReceiveResponse(request, nullptr);
  if (!okSend) {
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return false;
  }

  std::ofstream out(dest, std::ios::binary);
  if (!out) {
    WinHttpCloseHandle(request);
    WinHttpCloseHandle(connect);
    WinHttpCloseHandle(session);
    return false;
  }
  DWORD available = 0;
  std::vector<char> buffer(64 * 1024);
  while (WinHttpQueryDataAvailable(request, &available) && available > 0) {
    DWORD got = 0;
    const DWORD want = available > buffer.size() ? static_cast<DWORD>(buffer.size()) : available;
    if (!WinHttpReadData(request, buffer.data(), want, &got) || got == 0) break;
    out.write(buffer.data(), static_cast<std::streamsize>(got));
  }
  WinHttpCloseHandle(request);
  WinHttpCloseHandle(connect);
  WinHttpCloseHandle(session);
  return out.good();
}

bool WriteBytesToFile(const std::string& destUtf8, const std::vector<unsigned char>& bytes) {
  std::ofstream out(Utf8ToWide(destUtf8), std::ios::binary);
  if (!out) return false;
  if (!bytes.empty()) out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  return out.good();
}

std::string ChannelOf(const nlohmann::json& params) {
  const std::string raw = params.value("channel", params.value("role", "music"));
  return raw == "tts" ? "tts" : "music";
}

// SourceReader 输出固定为 16-bit PCM，交给 XAudio2 SourceVoice 直播
HRESULT SetPcmOutput(IMFSourceReader* reader) {
  IMFMediaType* type = nullptr;
  HRESULT hr = MFCreateMediaType(&type);
  if (SUCCEEDED(hr)) hr = type->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
  if (SUCCEEDED(hr)) hr = type->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_PCM);
  if (SUCCEEDED(hr)) hr = type->SetUINT32(MF_MT_AUDIO_BITS_PER_SAMPLE, 16);
  if (SUCCEEDED(hr)) hr = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, nullptr, type);
  if (type) type->Release();
  if (FAILED(hr)) return hr;
  return reader->SetStreamSelection(MF_SOURCE_READER_FIRST_AUDIO_STREAM, TRUE);
}

// 预读缓冲上限（约 24 个 sample ≈ 0.6s+ 的 MP3 帧），超过则让流式线程等待
constexpr UINT32 kMaxQueuedBuffers = 24;

}  // namespace

// XAudio2 回调不继承 IUnknown，生命周期由 Slot 管理（voice 销毁后 delete）
class AudioPlayer::VoiceCallback : public IXAudio2VoiceCallback {
 public:
  explicit VoiceCallback(AudioPlayer* owner) : owner_(owner) {}

  void STDMETHODCALLTYPE OnVoiceProcessingPassStart(UINT32) override {}
  void STDMETHODCALLTYPE OnVoiceProcessingPassEnd() override {}
  void STDMETHODCALLTYPE OnStreamEnd() override {}
  void STDMETHODCALLTYPE OnBufferStart(void*) override {}
  void STDMETHODCALLTYPE OnBufferEnd(void* context) override {
    if (context && owner_) owner_->HandleBufferEnd(static_cast<BufferContext*>(context));
  }
  void STDMETHODCALLTYPE OnLoopEnd(void*) override {}
  void STDMETHODCALLTYPE OnVoiceError(void*, HRESULT hr) override {
    LogLine("[player] voice error hr=" + std::to_string(static_cast<long>(hr)));
  }

 private:
  AudioPlayer* owner_ = nullptr;
};

AudioPlayer::AudioPlayer(NotifyFn notify) : notify_(std::move(notify)) {
  MFStartup(MF_VERSION);
  meterThread_ = std::thread([this]() { MeterLoop(); });
}

AudioPlayer::~AudioPlayer() {
  meterStop_.store(true);
  if (meterThread_.joinable()) meterThread_.join();
  CloseAll();
  MFShutdown();
}

AudioPlayer::Slot& AudioPlayer::SlotByName(const std::string& channel) {
  return channel == "tts" ? tts_ : music_;
}

const AudioPlayer::Slot& AudioPlayer::SlotByName(const std::string& channel) const {
  return channel == "tts" ? tts_ : music_;
}

void AudioPlayer::CloseSlot(Slot& slot) {
  slot.generation.fetch_add(1);  // 使旧流式线程 / 回调失效
  slot.playing.store(false);
  slot.paused.store(false);
  if (slot.stream.joinable()) slot.stream.join();

  if (slot.voice) {
    slot.voice->Stop(0, 0);
    slot.voice->FlushSourceBuffers();
    // 留给 XAudio2 回调线程一次触发 OnBufferEnd 的机会，避免释放后回调
    Sleep(50);
    slot.voice->DestroyVoice();
    slot.voice = nullptr;
  }
  if (slot.master) {
    slot.master->DestroyVoice();
    slot.master = nullptr;
  }
  if (slot.xaudio) {
    slot.xaudio->StopEngine();
    slot.xaudio->Release();
    slot.xaudio = nullptr;
  }
  if (slot.callback) {
    delete slot.callback;
    slot.callback = nullptr;
  }
  if (slot.reader) {
    slot.reader->Release();
    slot.reader = nullptr;
  }

  // 兜底释放未被回调消费的缓冲（从集合中移除者即拥有释放权）
  std::set<BufferContext*> leftover;
  {
    std::lock_guard lock(slot.buffersMutex);
    leftover.swap(slot.buffers);
    slot.meters.clear();
    slot.totalFrames = 0;
  }
  for (auto* ctx : leftover) delete ctx;

  if (!slot.tempFile.empty()) {
    DeleteFileW(slot.tempFile.c_str());
    slot.tempFile.clear();
  }
  slot.source.clear();
  slot.device.clear();
}

void AudioPlayer::CloseAll() {
  std::lock_guard lock(mutex_);
  CloseSlot(music_);
  CloseSlot(tts_);
}

std::wstring AudioPlayer::PrepareSource(Slot& slot, const std::string& url, const nlohmann::json& headers) {
  if (!headers.is_object() || headers.empty()) return Utf8ToWide(url);
  const std::wstring dest = TempAudioPath();
  LogLine("[player] downloading with headers");
  if (!DownloadToFile(url, headers, dest)) {
    DeleteFileW(dest.c_str());
    return {};
  }
  slot.tempFile = dest;
  return dest;
}

bool AudioPlayer::ApplyVolume(Slot& slot) {
  if (!slot.voice) return false;
  return SUCCEEDED(slot.voice->SetVolume(static_cast<float>(slot.volume) / 100.0f));
}

nlohmann::json AudioPlayer::Play(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);  // IPC 线程未必初始化过 COM
  std::lock_guard lock(mutex_);
  Slot& slot = SlotByName(channel);
  CloseSlot(slot);
  slot.url = params.value("url", "");
  slot.title = params.value("title", "");
  slot.device = params.value("device", "");
  slot.volume = params.value("volume", slot.volume);
  if (slot.volume < 0) slot.volume = 0;
  if (slot.volume > 100) slot.volume = 100;

  if (params.contains("bytes") && params["bytes"].is_array()) {
    std::vector<unsigned char> bytes;
    bytes.reserve(params["bytes"].size());
    for (const auto& item : params["bytes"]) bytes.push_back(static_cast<unsigned char>(item.get<int>()));
    const std::wstring dest = TempAudioPath();
    if (!WriteBytesToFile(WideToUtf8(dest), bytes)) {
      DeleteFileW(dest.c_str());
      return {{"ok", false}, {"error", "failed to write audio"}, {"channel", channel}};
    }
    slot.tempFile = dest;
    slot.source = dest;
    if (slot.url.empty()) slot.url = "bytes://" + channel;
  } else {
    if (slot.url.empty()) return {{"ok", false}, {"error", "url required"}, {"channel", channel}};
    const nlohmann::json headers = params.contains("headers") ? params["headers"] : nlohmann::json::object();
    slot.source = PrepareSource(slot, slot.url, headers);
  }
  if (slot.source.empty()) return {{"ok", false}, {"error", "failed to open media"}, {"channel", channel}};

  const std::wstring deviceId = Utf8ToWide(slot.device);
  if (FAILED(XAudio2Create(&slot.xaudio, 0, XAUDIO2_DEFAULT_PROCESSOR)) || !slot.xaudio) {
    CloseSlot(slot);
    return {{"ok", false}, {"error", "xaudio2 unavailable"}, {"channel", channel}};
  }
  // 指定输出设备（空 = 系统默认）
  if (FAILED(slot.xaudio->CreateMasteringVoice(&slot.master, 0, 0, 0,
                                               deviceId.empty() ? nullptr : deviceId.c_str(), nullptr))
      || !slot.master) {
    CloseSlot(slot);
    return {{"ok", false}, {"error", "failed to open output device"}, {"channel", channel}};
  }
  // XAudio2 引擎线程创建后处于停止状态，必须 StartEngine 才会处理任何 voice；
  // 缺失该调用时全部缓冲只排队不渲染——表现为“播放成功”但完全无声
  if (FAILED(slot.xaudio->StartEngine())) {
    CloseSlot(slot);
    LogLine("[player] StartEngine failed");
    return {{"ok", false}, {"error", "failed to start audio engine"}, {"channel", channel}};
  }
  if (FAILED(MFCreateSourceReaderFromURL(slot.source.c_str(), nullptr, &slot.reader)) || !slot.reader) {
    CloseSlot(slot);
    LogLine("[player] MFCreateSourceReaderFromURL failed");
    return {{"ok", false}, {"error", "failed to open media"}, {"channel", channel}};
  }
  if (FAILED(SetPcmOutput(slot.reader))) {
    CloseSlot(slot);
    return {{"ok", false}, {"error", "unsupported audio format"}, {"channel", channel}};
  }

  WAVEFORMATEX* format = nullptr;
  IMFMediaType* current = nullptr;
  if (FAILED(slot.reader->GetCurrentMediaType(MF_SOURCE_READER_FIRST_AUDIO_STREAM, &current))
      || !current
      || FAILED(MFCreateWaveFormatExFromMFMediaType(current, &format, nullptr))
      || !format) {
    if (current) current->Release();
    CloseSlot(slot);
    return {{"ok", false}, {"error", "unsupported audio stream"}, {"channel", channel}};
  }
  current->Release();

  slot.callback = new VoiceCallback(this);
  if (FAILED(slot.xaudio->CreateSourceVoice(&slot.voice, format, 0, XAUDIO2_DEFAULT_FREQ_RATIO,
                                            slot.callback, nullptr, nullptr))
      || !slot.voice) {
    CoTaskMemFree(format);
    CloseSlot(slot);
    LogLine("[player] CreateSourceVoice failed");
    return {{"ok", false}, {"error", "failed to create voice"}, {"channel", channel}};
  }
  slot.sampleRate = format->nSamplesPerSec ? format->nSamplesPerSec : 44100;
  slot.channels = format->nChannels ? format->nChannels : 2;
  CoTaskMemFree(format);

  // SourceVoice 创建后处于停止状态，必须显式 Start 才会渲染；
  // 缺失该调用会导致一切播放“成功”却完全无声（缓冲只排队、永不消费）
  if (FAILED(slot.voice->Start(0, 0))) {
    CloseSlot(slot);
    LogLine("[player] voice Start failed");
    return {{"ok", false}, {"error", "failed to start voice"}, {"channel", channel}};
  }

  slot.playing.store(true);
  slot.paused.store(false);
  const uint64_t generation = slot.generation.load();
  slot.stream = std::thread([this, channel, generation]() { StreamLoop(channel, generation); });

  ApplyVolume(slot);
  LogLine(std::string("[player] play ") + channel + " " + slot.url);
  return {{"ok", true}, {"url", slot.url}, {"title", slot.title}, {"volume", slot.volume}, {"channel", channel}};
}

void AudioPlayer::StreamLoop(const std::string& channel, uint64_t generation) {
  CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  Slot& slot = SlotByName(channel);
  const std::string url = slot.url;
  const std::string title = slot.title;
  LogLine("[player] stream enter " + channel);

  while (slot.generation.load() == generation) {
    DWORD flags = 0;
    IMFSample* sample = nullptr;
    const HRESULT hr = slot.reader->ReadSample(MF_SOURCE_READER_FIRST_AUDIO_STREAM, 0, nullptr, &flags, nullptr, &sample);
    if (FAILED(hr)) {
      LogLine("[player] ReadSample failed hr=" + std::to_string(static_cast<long>(hr)));
      break;  // 解码失败中止，循环外兜底广播 ended
    }
    const bool eof = (flags & MF_SOURCE_READERF_ENDOFSTREAM) != 0;

    if (sample) {
      IMFMediaBuffer* mediaBuffer = nullptr;
      BYTE* data = nullptr;
      DWORD size = 0;
      if (SUCCEEDED(sample->ConvertToContiguousBuffer(&mediaBuffer)) && mediaBuffer
          && SUCCEEDED(mediaBuffer->Lock(&data, nullptr, &size)) && size > 0) {
        auto* ctx = new BufferContext{};
        ctx->data.assign(data, data + size);
        ctx->channel = channel;
        ctx->generation = generation;
        ctx->url = url;
        ctx->title = title;
        ctx->last = eof;
        mediaBuffer->Unlock();

        // 提交前计算本块真实电平（RMS/峰值，0..1），随帧区间入队供计量线程对齐取值
        const size_t frameBytes = 2u * slot.channels;
        const uint64_t frames = frameBytes ? (ctx->data.size() / frameBytes) : 0;
        double sumSq = 0.0;
        int16_t peakAbs = 0;
        const int16_t* pcm = reinterpret_cast<const int16_t*>(ctx->data.data());
        const size_t sampleCount = ctx->data.size() / 2;
        for (size_t i = 0; i < sampleCount; ++i) {
          const int v = pcm[i];
          sumSq += static_cast<double>(v) * v;
          const int a = v < 0 ? -v : v;
          if (a > peakAbs) peakAbs = static_cast<int16_t>(a);
        }
        const float rms = sampleCount ? static_cast<float>(std::sqrt(sumSq / sampleCount) / 32768.0) : 0.0f;
        const float peak = peakAbs / 32768.0f;

        // 先登记再提交：OnBufferEnd 可能在 Submit 返回前触发
        {
          std::lock_guard lock(slot.buffersMutex);
          slot.buffers.insert(ctx);
          slot.meters.push_back({slot.totalFrames, slot.totalFrames + frames, rms, peak});
          slot.totalFrames += frames;
        }
        XAUDIO2_BUFFER buffer{};
        buffer.Flags = eof ? XAUDIO2_END_OF_STREAM : 0;
        buffer.AudioBytes = static_cast<UINT32>(ctx->data.size());
        buffer.pAudioData = ctx->data.data();
        buffer.pContext = ctx;
        const HRESULT submitHr = slot.voice->SubmitSourceBuffer(&buffer, nullptr);
        if (FAILED(submitHr)) {
          LogLine("[player] SubmitSourceBuffer failed hr=" + std::to_string(static_cast<long>(submitHr)));
          bool removed = false;
          {
            std::lock_guard lock(slot.buffersMutex);
            removed = slot.buffers.erase(ctx) > 0;
          }
          if (removed) delete ctx;
        }
      }
      if (mediaBuffer) mediaBuffer->Release();
      sample->Release();
    }

    if (eof) {
      LogLine("[player] stream eof " + channel);
      break;
    }

    // 预读节流，防止长音频一次性占满内存
    XAUDIO2_VOICE_STATE state{};
    slot.voice->GetState(&state);
    while (state.BuffersQueued > kMaxQueuedBuffers && slot.generation.load() == generation) {
      Sleep(50);
      slot.voice->GetState(&state);
    }
  }

  // 等待已提交缓冲全部渲染完成。OnBufferEnd 回调在本环境不触发，
  // 改用 GetState 轮询：队列清空即播完；CloseSlot 递增 generation 使等待失效
  while (slot.generation.load() == generation && slot.voice) {
    XAUDIO2_VOICE_STATE st{};
    slot.voice->GetState(&st);
    if (st.BuffersQueued == 0) break;
    Sleep(50);
  }
  if (slot.generation.load() == generation) {
    // 回调不可靠导致缓冲上下文可能残留，渲染完成后统一回收
    {
      std::lock_guard lock(slot.buffersMutex);
      for (auto* ctx : slot.buffers) delete ctx;
      slot.buffers.clear();
    }
    LogLine("[player] stream done " + channel);
    NotifyEnded(channel, generation, url, title, slot);
  }
  LogLine("[player] stream exit " + channel);
  CoUninitialize();
}

void AudioPlayer::MeterLoop() {
  while (!meterStop_.load()) {
    Sleep(33);
    if (meterStop_.load()) break;
    std::lock_guard lock(mutex_);
    Slot* slots[2] = {&music_, &tts_};
    for (Slot* slot : slots) {
      if (!slot->voice || !slot->playing.load() || slot->paused.load()) continue;
      XAUDIO2_VOICE_STATE st{};
      slot->voice->GetState(&st);
      const uint64_t played = st.SamplesPlayed;
      const char* channel = (slot == &tts_) ? "tts" : "music";
      Slot::MeterEntry current{};
      bool found = false;
      {
        std::lock_guard block(slot->buffersMutex);
        // 回收已完全播过的区间（保留最后一个，尾部电平短暂延续）
        while (slot->meters.size() > 1 && slot->meters.front().endFrame <= played) {
          slot->meters.pop_front();
        }
        if (!slot->meters.empty()) {
          const auto& e = slot->meters.front();
          if (played >= e.startFrame && played < e.endFrame) {
            current = e;
            found = true;
          }
        }
      }
      if (found) {
        notify_("player.levels", {
            {"channel", channel},
            {"rms", current.rms},
            {"peak", current.peak},
            {"positionMs", static_cast<double>(played) * 1000.0 / slot->sampleRate},
        });
      }
    }
  }
}

void AudioPlayer::HandleBufferEnd(BufferContext* context) {
  if (!context) return;
  const std::string channel = context->channel;
  const uint64_t generation = context->generation;
  const bool last = context->last;
  const std::string url = context->url;
  const std::string title = context->title;
  {
    Slot& slot = SlotByName(channel);
    std::lock_guard lock(slot.buffersMutex);
    // 所有权随 erase 转移：若已被 CloseSlot 换出（leftover），由 CloseSlot 负责释放，
    // 此处再 delete 会造成 double-free
    if (slot.buffers.erase(context) == 0) return;
  }
  delete context;
  if (last) NotifyEnded(channel, generation, url, title, SlotByName(channel));
}

void AudioPlayer::NotifyEnded(const std::string& channel, uint64_t generation,
                              const std::string& url, const std::string& title, Slot& slot) {
  if (slot.generation.load() != generation) return;
  slot.playing.store(false);
  slot.paused.store(false);
  LogLine(std::string("[player] ended ") + channel);
  notify_("player.ended", {{"url", url}, {"title", title}, {"channel", channel}});
}

nlohmann::json AudioPlayer::Stop(const nlohmann::json& params) {
  const bool both = !params.contains("channel") && !params.contains("role");
  std::lock_guard lock(mutex_);
  if (both) {
    CloseSlot(music_);
    CloseSlot(tts_);
    return {{"ok", true}, {"channel", "all"}};
  }
  const std::string channel = ChannelOf(params);
  CloseSlot(SlotByName(channel));
  return {{"ok", true}, {"channel", channel}};
}

nlohmann::json AudioPlayer::Pause(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
  std::lock_guard lock(mutex_);
  Slot& slot = SlotByName(channel);
  if (!slot.voice || !slot.playing.load()) return {{"ok", false}, {"error", "not playing"}, {"channel", channel}};
  const HRESULT hr = slot.voice->Stop(0, 0);
  slot.paused.store(SUCCEEDED(hr));
  return {{"ok", SUCCEEDED(hr)}, {"channel", channel}};
}

nlohmann::json AudioPlayer::Resume(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
  std::lock_guard lock(mutex_);
  Slot& slot = SlotByName(channel);
  if (!slot.voice) return {{"ok", false}, {"error", "not playing"}, {"channel", channel}};
  const HRESULT hr = slot.voice->Start(0, 0);
  if (SUCCEEDED(hr)) {
    slot.paused.store(false);
    slot.playing.store(true);
  }
  return {{"ok", SUCCEEDED(hr)}, {"channel", channel}};
}

nlohmann::json AudioPlayer::SetVolume(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
  int volume = params.value("volume", 80);
  if (volume < 0) volume = 0;
  if (volume > 100) volume = 100;
  std::lock_guard lock(mutex_);
  Slot& slot = SlotByName(channel);
  slot.volume = volume;
  ApplyVolume(slot);
  return {{"ok", true}, {"volume", slot.volume}, {"channel", channel}};
}

nlohmann::json AudioPlayer::SlotStatus(const Slot& slot, const std::string& channel) const {
  // queued：XAudio2 尚未消费的缓冲数——观察渲染是否真实进行
  UINT32 queued = 0;
  if (slot.voice) {
    XAUDIO2_VOICE_STATE state{};
    slot.voice->GetState(&state);
    queued = state.BuffersQueued;
  }
  return {
      {"channel", channel},
      {"playing", slot.playing.load() && !slot.paused.load()},
      {"paused", slot.paused.load()},
      {"volume", slot.volume},
      {"url", slot.url},
      {"title", slot.title},
      {"device", slot.device},
      {"queued", queued},
  };
}

nlohmann::json AudioPlayer::Status() const {
  std::lock_guard lock(mutex_);
  return {
      {"ok", true},
      {"playing", music_.playing.load() && !music_.paused.load()},
      {"paused", music_.paused.load()},
      {"volume", music_.volume},
      {"url", music_.url},
      {"title", music_.title},
      {"music", SlotStatus(music_, "music")},
      {"tts", SlotStatus(tts_, "tts")},
  };
}

nlohmann::json AudioPlayer::Devices() const {
  nlohmann::json list = nlohmann::json::array();
  IMMDeviceEnumerator* enumerator = nullptr;
  if (FAILED(CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&enumerator))) || !enumerator) {
    return {{"ok", false}, {"error", "mmdevice unavailable"}, {"devices", list}};
  }
  IMMDeviceCollection* collection = nullptr;
  if (FAILED(enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection)) || !collection) {
    enumerator->Release();
    return {{"ok", false}, {"error", "enum failed"}, {"devices", list}};
  }
  UINT count = 0;
  collection->GetCount(&count);
  IMMDevice* def = nullptr;
  std::wstring defaultId;
  if (SUCCEEDED(enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &def)) && def) {
    LPWSTR id = nullptr;
    if (SUCCEEDED(def->GetId(&id)) && id) {
      defaultId = id;
      CoTaskMemFree(id);
    }
    def->Release();
  }
  for (UINT i = 0; i < count; ++i) {
    IMMDevice* device = nullptr;
    if (FAILED(collection->Item(i, &device)) || !device) continue;
    LPWSTR id = nullptr;
    std::string idUtf8;
    if (SUCCEEDED(device->GetId(&id)) && id) {
      idUtf8 = WideToUtf8(id);
      CoTaskMemFree(id);
    }
    std::string name = idUtf8;
    IPropertyStore* props = nullptr;
    if (SUCCEEDED(device->OpenPropertyStore(STGM_READ, &props)) && props) {
      PROPVARIANT value;
      PropVariantInit(&value);
      if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &value)) && value.pwszVal) {
        name = WideToUtf8(value.pwszVal);
      }
      PropVariantClear(&value);
      props->Release();
    }
    list.push_back({
        {"id", idUtf8},
        {"name", name},
        {"default", !defaultId.empty() && Utf8ToWide(idUtf8) == defaultId},
    });
    device->Release();
  }
  collection->Release();
  enumerator->Release();
  return {{"ok", true}, {"devices", list}};
}

}  // namespace vtuber
