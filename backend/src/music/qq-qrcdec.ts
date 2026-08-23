/**
 * QQ 音乐 QRC 歌词解密（对照 fred913/goqrcdec 的 Go 实现逐行移植，其 3DES
 * 字节序与 OpenSSL 不兼容，无法直接用 crypto 模块替代）。
 * 流程：hex 解码 → 自定义 3DES-ECB 解密 → zlib 解压 → 去 UTF-8 BOM。
 */
import { inflateSync } from 'zlib'

const QRC_KEY = '!@#)(*$%123ZXC!@!@#)(NHL'

// 标准 DES S-Box（S1..S8）
const sbox1 = [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13]
const sbox2 = [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9]
const sbox3 = [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12]
const sbox4 = [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14]
const sbox5 = [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3]
const sbox6 = [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13]
const sbox7 = [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12]
const sbox8 = [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11]

// ---- 位操作（对照 Go 原版语义） ----

/** 从 byte 数组按 goqrcdec 的字节序约定取第 b 位（每 4 字节一组、组内字节倒序、字节内 MSB 在前） */
function bitNumKeyByte(a: number[] | Buffer, b: number, c: number): number {
  const i = Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)
  return (((a[i] >>> (7 - (b % 8))) & 0x01) << c) >>> 0
}

function bitNumIntr(a: number, b: number, c: number): number {
  return (((a >>> (31 - b)) & 0x01) << c) >>> 0
}

function bitNumIntl(a: number, b: number, c: number): number {
  return (((a << b) & 0x80000000) >>> c) >>> 0
}

/** 6-bit 输入重排后再查 S-Box */
function sboxBit(a: number): number {
  return (a & 0x20) | ((a & 0x1f) >> 1) | ((a & 0x01) << 4)
}

type Schedule = number[][] // [16][6]
type Schedules = Schedule[] // [3][16][6]

const KEY_RND_SHIFT = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const KEY_PERM_C = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35]
const KEY_PERM_D = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3]
const KEY_COMPRESSION = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36, 46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31]

function desKeySetup(key: number[], schedule: Schedule, mode: 'encrypt' | 'decrypt'): void {
  let C = 0
  let D = 0
  for (let i = 0; i < KEY_PERM_C.length; i++) C |= bitNumKeyByte(key, KEY_PERM_C[i], 31 - i)
  for (let i = 0; i < KEY_PERM_D.length; i++) D |= bitNumKeyByte(key, KEY_PERM_D[i], 31 - i)

  for (let i = 0; i < 16; i++) {
    const shift = KEY_RND_SHIFT[i]
    C = (((C << shift) | (C >>> (28 - shift))) & 0xfffffff0) >>> 0
    D = (((D << shift) | (D >>> (28 - shift))) & 0xfffffff0) >>> 0

    const subkeyIdx = mode === 'decrypt' ? 15 - i : i
    schedule[subkeyIdx] = [0, 0, 0, 0, 0, 0]
    for (let j = 0; j < 24; j++) {
      schedule[subkeyIdx][Math.floor(j / 8)] |= bitNumIntr(C, KEY_COMPRESSION[j], 7 - (j % 8))
    }
    for (let j = 24; j < 48; j++) {
      schedule[subkeyIdx][Math.floor(j / 8)] |= bitNumIntr(D, KEY_COMPRESSION[j] - 27, 7 - (j % 8))
    }
  }
}

function ip(state: number[], input: number[] | Buffer): void {
  state[0] =
    bitNumKeyByte(input, 57, 31) | bitNumKeyByte(input, 49, 30) | bitNumKeyByte(input, 41, 29) | bitNumKeyByte(input, 33, 28) |
    bitNumKeyByte(input, 25, 27) | bitNumKeyByte(input, 17, 26) | bitNumKeyByte(input, 9, 25) | bitNumKeyByte(input, 1, 24) |
    bitNumKeyByte(input, 59, 23) | bitNumKeyByte(input, 51, 22) | bitNumKeyByte(input, 43, 21) | bitNumKeyByte(input, 35, 20) |
    bitNumKeyByte(input, 27, 19) | bitNumKeyByte(input, 19, 18) | bitNumKeyByte(input, 11, 17) | bitNumKeyByte(input, 3, 16) |
    bitNumKeyByte(input, 61, 15) | bitNumKeyByte(input, 53, 14) | bitNumKeyByte(input, 45, 13) | bitNumKeyByte(input, 37, 12) |
    bitNumKeyByte(input, 29, 11) | bitNumKeyByte(input, 21, 10) | bitNumKeyByte(input, 13, 9) | bitNumKeyByte(input, 5, 8) |
    bitNumKeyByte(input, 63, 7) | bitNumKeyByte(input, 55, 6) | bitNumKeyByte(input, 47, 5) | bitNumKeyByte(input, 39, 4) |
    bitNumKeyByte(input, 31, 3) | bitNumKeyByte(input, 23, 2) | bitNumKeyByte(input, 15, 1) | bitNumKeyByte(input, 7, 0)
  state[1] =
    bitNumKeyByte(input, 56, 31) | bitNumKeyByte(input, 48, 30) | bitNumKeyByte(input, 40, 29) | bitNumKeyByte(input, 32, 28) |
    bitNumKeyByte(input, 24, 27) | bitNumKeyByte(input, 16, 26) | bitNumKeyByte(input, 8, 25) | bitNumKeyByte(input, 0, 24) |
    bitNumKeyByte(input, 58, 23) | bitNumKeyByte(input, 50, 22) | bitNumKeyByte(input, 42, 21) | bitNumKeyByte(input, 34, 20) |
    bitNumKeyByte(input, 26, 19) | bitNumKeyByte(input, 18, 18) | bitNumKeyByte(input, 10, 17) | bitNumKeyByte(input, 2, 16) |
    bitNumKeyByte(input, 60, 15) | bitNumKeyByte(input, 52, 14) | bitNumKeyByte(input, 44, 13) | bitNumKeyByte(input, 36, 12) |
    bitNumKeyByte(input, 28, 11) | bitNumKeyByte(input, 20, 10) | bitNumKeyByte(input, 12, 9) | bitNumKeyByte(input, 4, 8) |
    bitNumKeyByte(input, 62, 7) | bitNumKeyByte(input, 54, 6) | bitNumKeyByte(input, 46, 5) | bitNumKeyByte(input, 38, 4) |
    bitNumKeyByte(input, 30, 3) | bitNumKeyByte(input, 22, 2) | bitNumKeyByte(input, 14, 1) | bitNumKeyByte(input, 6, 0)
}

function invIP(state: number[], data: number[]): void {
  data[3] =
    bitNumIntr(state[1], 7, 7) | bitNumIntr(state[0], 7, 6) | bitNumIntr(state[1], 15, 5) | bitNumIntr(state[0], 15, 4) |
    bitNumIntr(state[1], 23, 3) | bitNumIntr(state[0], 23, 2) | bitNumIntr(state[1], 31, 1) | bitNumIntr(state[0], 31, 0)
  data[2] =
    bitNumIntr(state[1], 6, 7) | bitNumIntr(state[0], 6, 6) | bitNumIntr(state[1], 14, 5) | bitNumIntr(state[0], 14, 4) |
    bitNumIntr(state[1], 22, 3) | bitNumIntr(state[0], 22, 2) | bitNumIntr(state[1], 30, 1) | bitNumIntr(state[0], 30, 0)
  data[1] =
    bitNumIntr(state[1], 5, 7) | bitNumIntr(state[0], 5, 6) | bitNumIntr(state[1], 13, 5) | bitNumIntr(state[0], 13, 4) |
    bitNumIntr(state[1], 21, 3) | bitNumIntr(state[0], 21, 2) | bitNumIntr(state[1], 29, 1) | bitNumIntr(state[0], 29, 0)
  data[0] =
    bitNumIntr(state[1], 4, 7) | bitNumIntr(state[0], 4, 6) | bitNumIntr(state[1], 12, 5) | bitNumIntr(state[0], 12, 4) |
    bitNumIntr(state[1], 20, 3) | bitNumIntr(state[0], 20, 2) | bitNumIntr(state[1], 28, 1) | bitNumIntr(state[0], 28, 0)
  data[7] =
    bitNumIntr(state[1], 3, 7) | bitNumIntr(state[0], 3, 6) | bitNumIntr(state[1], 11, 5) | bitNumIntr(state[0], 11, 4) |
    bitNumIntr(state[1], 19, 3) | bitNumIntr(state[0], 19, 2) | bitNumIntr(state[1], 27, 1) | bitNumIntr(state[0], 27, 0)
  data[6] =
    bitNumIntr(state[1], 2, 7) | bitNumIntr(state[0], 2, 6) | bitNumIntr(state[1], 10, 5) | bitNumIntr(state[0], 10, 4) |
    bitNumIntr(state[1], 18, 3) | bitNumIntr(state[0], 18, 2) | bitNumIntr(state[1], 26, 1) | bitNumIntr(state[0], 26, 0)
  data[5] =
    bitNumIntr(state[1], 1, 7) | bitNumIntr(state[0], 1, 6) | bitNumIntr(state[1], 9, 5) | bitNumIntr(state[0], 9, 4) |
    bitNumIntr(state[1], 17, 3) | bitNumIntr(state[0], 17, 2) | bitNumIntr(state[1], 25, 1) | bitNumIntr(state[0], 25, 0)
  data[4] =
    bitNumIntr(state[1], 0, 7) | bitNumIntr(state[0], 0, 6) | bitNumIntr(state[1], 8, 5) | bitNumIntr(state[0], 8, 4) |
    bitNumIntr(state[1], 16, 3) | bitNumIntr(state[0], 16, 2) | bitNumIntr(state[1], 24, 1) | bitNumIntr(state[0], 24, 0)
}

function fFunc(state: number, key: number[]): number {
  const lrgState = new Array<number>(6).fill(0)
  const t1 =
    bitNumIntl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitNumIntl(state, 4, 5) | bitNumIntl(state, 3, 6) |
    ((state & 0x0f000000) >>> 3) | bitNumIntl(state, 8, 11) | bitNumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) |
    bitNumIntl(state, 12, 17) | bitNumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitNumIntl(state, 16, 23)
  const t2 =
    bitNumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitNumIntl(state, 20, 5) | bitNumIntl(state, 19, 6) |
    ((state & 0x00000f00) << 13) | bitNumIntl(state, 24, 11) | bitNumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) |
    bitNumIntl(state, 28, 17) | bitNumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitNumIntl(state, 0, 23)
  lrgState[0] = (t1 >>> 24) & 0xff
  lrgState[1] = (t1 >>> 16) & 0xff
  lrgState[2] = (t1 >>> 8) & 0xff
  lrgState[3] = (t2 >>> 24) & 0xff
  lrgState[4] = (t2 >>> 16) & 0xff
  lrgState[5] = (t2 >>> 8) & 0xff

  for (let i = 0; i < 6; i++) lrgState[i] ^= key[i]

  let out =
    (sbox1[sboxBit(lrgState[0] >> 2)] << 28) | (sbox2[sboxBit(((lrgState[0] & 0x03) << 4) | (lrgState[1] >> 4))] << 24) |
    (sbox3[sboxBit(((lrgState[1] & 0x0f) << 2) | (lrgState[2] >> 6))] << 20) | (sbox4[sboxBit(lrgState[2] & 0x3f)] << 16) |
    (sbox5[sboxBit(lrgState[3] >> 2)] << 12) | (sbox6[sboxBit(((lrgState[3] & 0x03) << 4) | (lrgState[4] >> 4))] << 8) |
    (sbox7[sboxBit(((lrgState[4] & 0x0f) << 2) | (lrgState[5] >> 6))] << 4) | sbox8[sboxBit(lrgState[5] & 0x3f)]
  out =
    bitNumIntl(out, 15, 0) | bitNumIntl(out, 6, 1) | bitNumIntl(out, 19, 2) | bitNumIntl(out, 20, 3) |
    bitNumIntl(out, 28, 4) | bitNumIntl(out, 11, 5) | bitNumIntl(out, 27, 6) | bitNumIntl(out, 16, 7) |
    bitNumIntl(out, 0, 8) | bitNumIntl(out, 14, 9) | bitNumIntl(out, 22, 10) | bitNumIntl(out, 25, 11) |
    bitNumIntl(out, 4, 12) | bitNumIntl(out, 17, 13) | bitNumIntl(out, 30, 14) | bitNumIntl(out, 9, 15) |
    bitNumIntl(out, 1, 16) | bitNumIntl(out, 7, 17) | bitNumIntl(out, 23, 18) | bitNumIntl(out, 13, 19) |
    bitNumIntl(out, 31, 20) | bitNumIntl(out, 26, 21) | bitNumIntl(out, 2, 22) | bitNumIntl(out, 8, 23) |
    bitNumIntl(out, 18, 24) | bitNumIntl(out, 12, 25) | bitNumIntl(out, 29, 26) | bitNumIntl(out, 5, 27) |
    bitNumIntl(out, 21, 28) | bitNumIntl(out, 10, 29) | bitNumIntl(out, 3, 30) | bitNumIntl(out, 24, 31)
  return out >>> 0
}

function desCrypt(dataIn: number[] | Buffer, dataOut: number[], key: Schedule): void {
  const state = [0, 0]
  ip(state, dataIn)
  for (let idx = 0; idx < 15; idx++) {
    const t = state[1]
    state[1] = (fFunc(state[1], key[idx]) ^ state[0]) >>> 0
    state[0] = t
  }
  state[0] = (fFunc(state[1], key[15]) ^ state[0]) >>> 0
  invIP(state, dataOut)
}

function threeDesKeySetup(key: number[], schedule: Schedules, mode: 'encrypt' | 'decrypt'): void {
  if (mode === 'encrypt') {
    desKeySetup(key.slice(0), schedule[0], 'encrypt')
    desKeySetup(key.slice(8), schedule[1], 'decrypt')
    desKeySetup(key.slice(16), schedule[2], 'encrypt')
  } else {
    desKeySetup(key.slice(0), schedule[2], 'decrypt')
    desKeySetup(key.slice(8), schedule[1], 'encrypt')
    desKeySetup(key.slice(16), schedule[0], 'decrypt')
  }
}

function threeDesCrypt(dataIn: number[] | Buffer, dataOut: number[], key: Schedules): void {
  desCrypt(dataIn, dataOut, key[0])
  desCrypt(dataOut, dataOut, key[1])
  desCrypt(dataOut, dataOut, key[2])
}

/** 解密 + 解压 QRC 歌词，输入为 hex 字符串 */
export function decodeQrc(hexStr: string): string {
  const data = Buffer.from(hexStr, 'hex')
  if (data.length > 11 && data.subarray(0, 11).toString('latin1') === '[offset:0]\n') {
    return data.subarray(11).toString('utf8')
  }
  const keyBytes = Buffer.from(QRC_KEY, 'utf8')
  const schedule: Schedules = [
    Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]),
    Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]),
    Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]),
  ]
  threeDesKeySetup([...keyBytes], schedule, 'decrypt')

  const newData = Buffer.alloc(data.length)
  const block = new Array<number>(8).fill(0)
  for (let i = 0; i < data.length; i += 8) {
    const blockLen = Math.min(8, data.length - i)
    for (let j = 0; j < 8; j++) block[j] = i + j < data.length ? data[i + j] : 0
    threeDesCrypt(block, block, schedule)
    for (let j = 0; j < blockLen; j++) newData[i + j] = block[j]
  }

  let result: Buffer
  try {
    result = inflateSync(newData)
  } catch {
    throw new Error('qrc lyric inflate failed')
  }
  if (result.length >= 3 && result[0] === 0xef && result[1] === 0xbb && result[2] === 0xbf) {
    result = result.subarray(3)
  }
  return result.toString('utf8')
}
