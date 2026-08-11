/**
 * Electron Preload Script
 * 在渲染进程中暴露安全的 API
 */

const { contextBridge, ipcRenderer } = require('electron')

// 暴露 IPC API 到渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 监听来自主进程的消息
  on: (channel, callback) => {
    const validChannels = [
      'live2d:load',
      'live2d:expression',
      'live2d:motion',
      'live2d:scale',
      'live2d:position',
      'display.update',
      'display.clear',
      'music:play',
      'music:pause',
      'music:volume',
      'tts:audio'
    ]

    if (validChannels.includes(channel)) {
      // 包装回调，只传递 data 部分
      ipcRenderer.on(channel, (event, data) => callback(data))
    }
  },

  // 发送消息到主进程
  send: (channel, data) => {
    const validChannels = [
      'window:ready',
      'music:ended',
      'music:error',
      'live2d:loaded',
      'live2d:error'
    ]

    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data)
    }
  },

  // 双向通信（发送并等待响应）
  invoke: (channel, data) => {
    const validChannels = [
      'get-config',
      'get-status'
    ]

    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data)
    }
  }
})

// 暴露版本信息
contextBridge.exposeInMainWorld('versions', {
  node: process.versions.node,
  chrome: process.versions.chrome,
  electron: process.versions.electron
})

// 打印启动信息
console.log('Preload script loaded')
console.log('Electron version:', process.versions.electron)
