#include "app.h"
#include "platform.h"

int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
  vtuber::InitLog();
  const int code = vtuber::App::instance().run(__argc, __wargv);
  CoUninitialize();
  return code;
}
