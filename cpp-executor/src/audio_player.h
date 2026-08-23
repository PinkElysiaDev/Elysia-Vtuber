#pragma once

#include <atomic>
#include <deque>
#include <functional>
#include <mutex>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include <windows.h>

#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <nlohmann/json.hpp>
#include <xaudio2.h>

namespace vtuber {

/**
 * XAudio2 + IMFSourceReader 播放器。
 * 每个通道（music/tts）独立的 IXAudio2 实例与 MasteringVoice，
 * CreateMasteringVoice 直接接收 MMDevice endpoint id，实现按设备输出。
 * 与宿主进程（App / audio_main）完全解耦，仅通过 NotifyFn 回调推送事件。
 */
class AudioPlayer {
 public:
  /** 事件推送回调（须线程安全：计量线程/流式线程/XAudio2 回调线程均会调用） */
  using NotifyFn = std::function<void(const std::string& method, const nlohmann::json& params)>;

  explicit AudioPlayer(NotifyFn notify);
  ~AudioPlayer();

  nlohmann::json Play(const nlohmann::json& params);
  nlohmann::json Stop(const nlohmann::json& params);
  nlohmann::json Pause(const nlohmann::json& params);
  nlohmann::json Resume(const nlohmann::json& params);
  nlohmann::json SetVolume(const nlohmann::json& params);
  nlohmann::json Status() const;
  nlohmann::json Devices() const;

 private:
  // 由 voice 回调持有；data 须在缓冲播完前保持有效
  struct BufferContext {
    std::vector<unsigned char> data;
    std::string channel;
    uint64_t generation = 0;
    bool last = false;
    std::string url;
    std::string title;
  };

  class VoiceCallback;

  struct Slot {
    IXAudio2* xaudio = nullptr;
    IXAudio2MasteringVoice* master = nullptr;
    IXAudio2SourceVoice* voice = nullptr;
    IMFSourceReader* reader = nullptr;
    VoiceCallback* callback = nullptr;
    std::thread stream;
    // 播放代际：Play/Close 时递增，使旧流式线程与回调失效
    std::atomic<uint64_t> generation{0};
    std::wstring source;
    std::string url;
    std::string title;
    std::string device;
    std::wstring tempFile;
    int volume = 80;
    std::atomic<bool> playing{false};
    std::atomic<bool> paused{false};
    // 已提交未播完的缓冲；回调与 CloseSlot 在锁内交接释放权
    mutable std::mutex buffersMutex;
    std::set<BufferContext*> buffers;
    // 实时电平计量：提交缓冲时记录 RMS/峰值随帧区间，计量线程按 SamplesPlayed 对齐取值
    struct MeterEntry {
      uint64_t startFrame;
      uint64_t endFrame;
      float rms;
      float peak;
    };
    std::deque<MeterEntry> meters;  // 与 buffers 共用 buffersMutex
    uint32_t sampleRate = 44100;
    uint16_t channels = 2;
    uint64_t totalFrames = 0;
  };

  void CloseSlot(Slot& slot);
  void CloseAll();
  Slot& SlotByName(const std::string& channel);
  const Slot& SlotByName(const std::string& channel) const;
  bool ApplyVolume(Slot& slot);
  std::wstring PrepareSource(Slot& slot, const std::string& url, const nlohmann::json& headers);
  void StreamLoop(const std::string& channel, uint64_t generation);
  /** 计量线程：~30Hz 读取各通道当前可闻电平并经 app_.notify 广播 player.levels */
  void MeterLoop();
  void HandleBufferEnd(BufferContext* context);
  void NotifyEnded(const std::string& channel, uint64_t generation,
                   const std::string& url, const std::string& title, Slot& slot);
  nlohmann::json SlotStatus(const Slot& slot, const std::string& channel) const;

  NotifyFn notify_;
  mutable std::mutex mutex_;
  Slot music_;
  Slot tts_;
  std::thread meterThread_;
  std::atomic<bool> meterStop_{false};
};

}  // namespace vtuber
