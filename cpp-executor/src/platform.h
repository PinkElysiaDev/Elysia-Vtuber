#pragma once

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <string>
#include <utility>
#include <vector>

#include <CubismFramework.hpp>
#include <ICubismAllocator.hpp>

namespace vtuber {

class Allocator : public Csm::ICubismAllocator {
 public:
  void* Allocate(const Csm::csmSizeType size) override { return malloc(size); }
  void Deallocate(void* memory) override { free(memory); }

  void* AllocateAligned(const Csm::csmSizeType size, const Csm::csmUint32 alignment) override {
    const size_t offset = alignment - 1 + sizeof(void*);
    void* allocation = Allocate(size + static_cast<Csm::csmUint32>(offset));
    if (!allocation) return nullptr;
    size_t aligned = reinterpret_cast<size_t>(allocation) + sizeof(void*);
    const size_t shift = aligned % alignment;
    if (shift) aligned += (alignment - shift);
    reinterpret_cast<void**>(aligned)[-1] = allocation;
    return reinterpret_cast<void*>(aligned);
  }

  void DeallocateAligned(void* alignedMemory) override {
    if (!alignedMemory) return;
    Deallocate(reinterpret_cast<void**>(alignedMemory)[-1]);
  }
};

struct FileBytes {
  std::vector<Csm::csmByte> data;
  Csm::csmByte* ptr() { return data.empty() ? nullptr : data.data(); }
  Csm::csmSizeInt size() const { return static_cast<Csm::csmSizeInt>(data.size()); }
  bool empty() const { return data.empty(); }
};

FileBytes LoadFile(const std::string& path);
std::wstring Utf8ToWide(const std::string& utf8);
std::string WideToUtf8(const std::wstring& wide);
std::string JoinPath(const std::string& dir, const std::string& name);
std::string DirName(const std::string& path);
std::string FileName(const std::string& path);
std::string ExeDir();
std::string ResolvePath(const std::string& path);
void InitLog();
void LogLine(const std::string& line);

}  // namespace vtuber
