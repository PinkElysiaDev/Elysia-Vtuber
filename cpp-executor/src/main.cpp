#include "app.h"
#include "platform.h"

#include <Windows.h>

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  vtuber::InitLog();
  const int code = vtuber::App::instance().run(__argc, __wargv);
  vtuber::LogLine(code == 0 ? "[app] clean exit" : "[app] exit with error");
  CoUninitialize();
  // 清理已在 run() 内完整完成（IPC/音频/Cubism/D3D 依次释放）。
  // 直接 ExitProcess 跳过静态析构阶段——该阶段 websocketpp/asio 的析构
  // 存在访问违例（0xC0000005），且此时已无资源需要析构释放。
  ExitProcess(static_cast<UINT>(code));
}
