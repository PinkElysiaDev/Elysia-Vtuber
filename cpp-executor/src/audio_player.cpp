#include "audio_player.h"

#include "app.h"
#include "platform.h"

#define INITGUID
#include <atomic>
#include <functiondiscoverykeys_devpkey.h>
#include <mmdeviceapi.h>
#include <mfapi.h>
#include <fstream>
#include <vector>
#include <winhttp.h>

#pragma comment(lib, "mfplay.lib")
#pragma comment(lib, "mfplat.lib")
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

}  // namespace

class AudioPlayer::Callback : public IMFPMediaPlayerCallback {
 public:
  Callback(AudioPlayer* owner, std::string channel) : owner_(owner), channel_(std::move(channel)) {}

  HRESULT STDMETHODCALLTYPE QueryInterface(REFIID riid, void** ppv) override {
    if (!ppv) return E_POINTER;
    if (riid == IID_IUnknown || riid == __uuidof(IMFPMediaPlayerCallback)) {
      *ppv = static_cast<IMFPMediaPlayerCallback*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  ULONG STDMETHODCALLTYPE AddRef() override { return ++ref_; }
  ULONG STDMETHODCALLTYPE Release() override {
    const ULONG n = --ref_;
    if (!n) delete this;
    return n;
  }
  void STDMETHODCALLTYPE OnMediaPlayerEvent(MFP_EVENT_HEADER* header) override {
    if (!header || !owner_) return;
    if (header->eEventType == MFP_EVENT_TYPE_PLAYBACK_ENDED) owner_->OnEnded(channel_);
  }

 private:
  AudioPlayer* owner_ = nullptr;
  std::string channel_;
  std::atomic<ULONG> ref_{1};
};

AudioPlayer::AudioPlayer(App& app) : app_(app) {
  MFStartup(MF_VERSION);
}

AudioPlayer::~AudioPlayer() {
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
  slot.playing = false;
  slot.paused = false;
  if (slot.player) {
    slot.player->Stop();
    slot.player->Shutdown();
    slot.player->Release();
    slot.player = nullptr;
  }
  if (slot.callback) {
    slot.callback->Release();
    slot.callback = nullptr;
  }
  if (!slot.tempFile.empty()) {
    DeleteFileW(slot.tempFile.c_str());
    slot.tempFile.clear();
  }
  slot.source.clear();
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
  if (!slot.player) return false;
  return SUCCEEDED(slot.player->SetVolume(static_cast<float>(slot.volume) / 100.0f));
}

nlohmann::json AudioPlayer::Play(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
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

  slot.callback = new Callback(this, channel);
  const HRESULT hr = MFPCreateMediaPlayer(slot.source.c_str(), TRUE, 0, slot.callback, nullptr, &slot.player);
  if (FAILED(hr) || !slot.player) {
    LogLine("[player] MFPCreateMediaPlayer failed");
    if (slot.callback) {
      slot.callback->Release();
      slot.callback = nullptr;
    }
    return {{"ok", false}, {"error", "media foundation unavailable"}, {"channel", channel}};
  }
  ApplyVolume(slot);
  slot.playing = true;
  slot.paused = false;
  LogLine(std::string("[player] play ") + channel + " " + slot.url);
  return {{"ok", true}, {"url", slot.url}, {"title", slot.title}, {"volume", slot.volume}, {"channel", channel}};
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
  if (!slot.player || !slot.playing) return {{"ok", false}, {"error", "not playing"}, {"channel", channel}};
  const HRESULT hr = slot.player->Pause();
  slot.paused = SUCCEEDED(hr);
  return {{"ok", slot.paused}, {"channel", channel}};
}

nlohmann::json AudioPlayer::Resume(const nlohmann::json& params) {
  const std::string channel = ChannelOf(params);
  std::lock_guard lock(mutex_);
  Slot& slot = SlotByName(channel);
  if (!slot.player) return {{"ok", false}, {"error", "not playing"}, {"channel", channel}};
  const HRESULT hr = slot.player->Play();
  if (SUCCEEDED(hr)) {
    slot.playing = true;
    slot.paused = false;
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
  return {
      {"channel", channel},
      {"playing", slot.playing && !slot.paused},
      {"paused", slot.paused},
      {"volume", slot.volume},
      {"url", slot.url},
      {"title", slot.title},
      {"device", slot.device},
  };
}

nlohmann::json AudioPlayer::Status() const {
  std::lock_guard lock(mutex_);
  return {
      {"ok", true},
      {"playing", music_.playing && !music_.paused},
      {"paused", music_.paused},
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

void AudioPlayer::OnEnded(const std::string& channel) {
  std::string endedUrl;
  std::string endedTitle;
  {
    std::lock_guard lock(mutex_);
    Slot& slot = SlotByName(channel);
    slot.playing = false;
    slot.paused = false;
    endedUrl = slot.url;
    endedTitle = slot.title;
  }
  LogLine(std::string("[player] ended ") + channel);
  app_.notify("player.ended", {{"url", endedUrl}, {"title", endedTitle}, {"channel", channel}});
}

}  // namespace vtuber
