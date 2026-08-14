#pragma once

#include <atomic>
#include <mutex>
#include <string>
#include <vector>

#include <mfplay.h>
#include <nlohmann/json.hpp>
#include <windows.h>

namespace vtuber {

class App;

class AudioPlayer {
 public:
  explicit AudioPlayer(App& app);
  ~AudioPlayer();

  nlohmann::json Play(const nlohmann::json& params);
  nlohmann::json Stop(const nlohmann::json& params);
  nlohmann::json Pause(const nlohmann::json& params);
  nlohmann::json Resume(const nlohmann::json& params);
  nlohmann::json SetVolume(const nlohmann::json& params);
  nlohmann::json Status() const;
  nlohmann::json Devices() const;

  void OnEnded(const std::string& channel);

 private:
  class Callback;

  struct Slot {
    IMFPMediaPlayer* player = nullptr;
    Callback* callback = nullptr;
    std::wstring source;
    std::string url;
    std::string title;
    std::string device;
    std::wstring tempFile;
    int volume = 80;
    bool playing = false;
    bool paused = false;
  };

  void CloseSlot(Slot& slot);
  void CloseAll();
  Slot& SlotByName(const std::string& channel);
  const Slot& SlotByName(const std::string& channel) const;
  bool ApplyVolume(Slot& slot);
  std::wstring PrepareSource(Slot& slot, const std::string& url, const nlohmann::json& headers);
  nlohmann::json SlotStatus(const Slot& slot, const std::string& channel) const;

  App& app_;
  mutable std::mutex mutex_;
  Slot music_;
  Slot tts_;
};

}  // namespace vtuber
