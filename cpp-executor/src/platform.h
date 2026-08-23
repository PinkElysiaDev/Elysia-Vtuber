#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace vtuber {

// 纯工具函数：无 Cubism 依赖，音频/Live2D 两个执行器共用

struct FileBytes {
  std::vector<unsigned char> data;
  unsigned char* ptr() { return data.empty() ? nullptr : data.data(); }
  size_t size() const { return data.size(); }
  bool empty() const { return data.empty(); }
};

FileBytes LoadFile(const std::string& path);
std::wstring Utf8ToWide(const std::string& utf8);
std::string WideToUtf8(const std::wstring& wide);
std::string JoinPath(const std::string& dir, const std::string& name);
std::string DirName(const std::string& path);
std::string ExeDir();
std::string ResolvePath(const std::string& path);
void InitLog();
void LogLine(const std::string& line);

}  // namespace vtuber
