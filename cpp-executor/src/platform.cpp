#include "platform.h"

#include <cstdio>
#include <fstream>
#include <windows.h>

namespace vtuber {

namespace {
std::ofstream g_bootLog;
HANDLE g_stdout = INVALID_HANDLE_VALUE;

void WriteOs(HANDLE handle, const std::string& text) {
  if (!handle || handle == INVALID_HANDLE_VALUE) return;
  DWORD written = 0;
  WriteFile(handle, text.data(), static_cast<DWORD>(text.size()), &written, nullptr);
}
} // namespace

void InitLog() {
  const std::string exeDir = ExeDir();
  SetCurrentDirectoryW(Utf8ToWide(exeDir).c_str());
  g_bootLog.open(JoinPath(exeDir, "executor.log"), std::ios::out | std::ios::trunc);
  HANDLE handle = GetStdHandle(STD_OUTPUT_HANDLE);
  if (handle && handle != INVALID_HANDLE_VALUE && GetFileType(handle) != FILE_TYPE_UNKNOWN) {
    g_stdout = handle;
  }
  LogLine(std::string("[platform] cwd=") + exeDir);
}

void LogLine(const std::string& line) {
  const std::string withNl = line + "\n";
  if (g_bootLog.is_open()) {
    g_bootLog << withNl;
    g_bootLog.flush();
  }
  WriteOs(g_stdout, withNl);
}

FileBytes LoadFile(const std::string& path) {
  FileBytes out;
  std::ifstream file(Utf8ToWide(path), std::ios::binary);
  if (!file) return out;
  file.seekg(0, std::ios::end);
  const auto size = file.tellg();
  if (size <= 0) return out;
  out.data.resize(static_cast<size_t>(size));
  file.seekg(0);
  file.read(reinterpret_cast<char*>(out.data.data()), static_cast<std::streamsize>(size));
  return out;
}

std::wstring Utf8ToWide(const std::string& utf8) {
  if (utf8.empty()) return {};
  const int len = MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), nullptr, 0);
  if (len <= 0) return {};
  std::wstring wide(len, L'\0');
  MultiByteToWideChar(CP_UTF8, 0, utf8.data(), static_cast<int>(utf8.size()), wide.data(), len);
  return wide;
}

std::string WideToUtf8(const std::wstring& wide) {
  if (wide.empty()) return {};
  const int len = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
  if (len <= 0) return {};
  std::string utf8(len, '\0');
  WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), len, nullptr, nullptr);
  return utf8;
}

std::string JoinPath(const std::string& dir, const std::string& name) {
  if (dir.empty()) return name;
  const char last = dir.back();
  if (last == '/' || last == '\\') return dir + name;
  return dir + "/" + name;
}

std::string DirName(const std::string& path) {
  const auto pos = path.find_last_of("\\/");
  if (pos == std::string::npos) return ".";
  return path.substr(0, pos);
}

std::string ExeDir() {
  wchar_t buf[MAX_PATH]{};
  GetModuleFileNameW(nullptr, buf, MAX_PATH);
  std::wstring path(buf);
  const auto pos = path.find_last_of(L"\\/");
  if (pos != std::wstring::npos) path.resize(pos);
  return WideToUtf8(path);
}

std::string ResolvePath(const std::string& path) {
  if (path.size() >= 2 && path[1] == ':') return path;
  return JoinPath(ExeDir(), path);
}

}  // namespace vtuber
