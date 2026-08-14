const SECRET_KEY = Buffer.from('ylzsxkwm')

const ARRAY_IP = [
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
  56, 48, 40, 32, 24, 16, 8, 0, 58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6,
]
const ARRAY_E = [
  31, 0, 1, 2, 3, 4, -1, -1, 3, 4, 5, 6, 7, 8, -1, -1, 7, 8, 9, 10, 11, 12, -1, -1, 11, 12, 13, 14, 15, 16, -1, -1, 15, 16, 17,
  18, 19, 20, -1, -1, 19, 20, 21, 22, 23, 24, -1, -1, 23, 24, 25, 26, 27, 28, -1, -1, 27, 28, 29, 30, 31, 30, -1, -1,
]
const SBOX = [
  [14, 4, 3, 15, 2, 13, 5, 3, 13, 14, 6, 9, 11, 2, 0, 5, 4, 1, 10, 12, 15, 6, 9, 10, 1, 8, 12, 7, 8, 11, 7, 0, 0, 15, 10, 5, 14, 4, 9, 10, 7, 8, 12, 3, 13, 1, 3, 6, 15, 12, 6, 11, 2, 9, 5, 0, 4, 2, 11, 14, 1, 7, 8, 13],
  [15, 0, 9, 5, 6, 10, 12, 9, 8, 7, 2, 12, 3, 13, 5, 2, 1, 14, 7, 8, 11, 4, 0, 3, 14, 11, 13, 6, 4, 1, 10, 15, 3, 13, 12, 11, 15, 3, 6, 0, 4, 10, 1, 7, 8, 4, 11, 14, 13, 8, 0, 6, 2, 15, 9, 5, 7, 1, 10, 12, 14, 2, 5, 9],
  [10, 13, 1, 11, 6, 8, 11, 5, 9, 4, 12, 2, 15, 3, 2, 14, 0, 6, 13, 1, 3, 15, 4, 10, 14, 9, 7, 12, 5, 0, 8, 7, 13, 1, 2, 4, 3, 6, 12, 11, 0, 13, 5, 14, 6, 8, 15, 2, 7, 10, 8, 15, 4, 9, 11, 5, 9, 0, 14, 3, 10, 7, 1, 12],
  [7, 10, 1, 15, 0, 12, 11, 5, 14, 9, 8, 3, 9, 7, 4, 8, 13, 6, 2, 1, 6, 11, 12, 2, 3, 0, 5, 14, 10, 13, 15, 4, 13, 3, 4, 9, 6, 10, 1, 12, 11, 0, 2, 5, 0, 13, 14, 2, 8, 15, 7, 4, 15, 1, 10, 7, 5, 6, 12, 11, 3, 8, 9, 14],
  [2, 4, 8, 15, 7, 10, 13, 6, 4, 1, 3, 12, 11, 7, 14, 0, 12, 2, 5, 9, 10, 13, 0, 3, 1, 11, 15, 5, 6, 8, 9, 14, 14, 11, 5, 6, 4, 1, 3, 10, 2, 12, 15, 0, 13, 2, 8, 5, 11, 8, 0, 15, 7, 14, 9, 4, 12, 7, 10, 9, 1, 13, 6, 3],
  [12, 9, 0, 7, 9, 2, 14, 1, 10, 15, 3, 4, 6, 12, 5, 11, 1, 14, 13, 0, 2, 8, 7, 13, 15, 5, 4, 10, 8, 3, 11, 6, 10, 4, 6, 11, 7, 9, 0, 6, 4, 2, 13, 1, 9, 15, 3, 8, 15, 3, 1, 14, 12, 5, 11, 0, 2, 12, 14, 7, 5, 10, 8, 13],
  [4, 1, 3, 10, 15, 12, 5, 0, 2, 11, 9, 6, 8, 7, 6, 9, 11, 4, 12, 15, 0, 3, 10, 5, 14, 13, 7, 8, 13, 14, 1, 2, 13, 6, 14, 9, 4, 1, 2, 14, 11, 13, 5, 0, 1, 10, 8, 3, 0, 11, 3, 5, 9, 4, 15, 2, 7, 8, 12, 15, 10, 7, 6, 12],
  [13, 7, 10, 0, 6, 9, 5, 15, 8, 4, 3, 10, 11, 14, 12, 5, 2, 11, 9, 6, 15, 12, 0, 3, 4, 1, 14, 13, 1, 2, 7, 8, 1, 2, 12, 15, 10, 4, 0, 3, 13, 14, 6, 9, 7, 8, 9, 6, 15, 1, 5, 12, 3, 10, 14, 5, 8, 7, 11, 0, 4, 13, 2, 11],
]
const ARRAY_P = [15, 6, 19, 20, 28, 11, 27, 16, 0, 14, 22, 25, 4, 17, 30, 9, 1, 7, 23, 13, 31, 26, 2, 8, 18, 12, 29, 5, 21, 10, 3, 24]
const ARRAY_IP1 = [
  39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28,
  35, 3, 43, 11, 51, 19, 59, 27, 34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25, 32, 0, 40, 8, 48, 16, 56, 24,
]
const ARRAY_PC1 = [
  56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35,
  62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3,
]
const ARRAY_PC2 = [
  13, 16, 10, 23, 0, 4, -1, -1, 2, 27, 14, 5, 20, 9, -1, -1, 22, 18, 11, 3, 25, 7, -1, -1, 15, 6, 26, 19, 12, 1, -1, -1,
  40, 51, 30, 36, 46, 54, -1, -1, 29, 39, 50, 44, 32, 47, -1, -1, 43, 48, 38, 55, 33, 52, -1, -1, 45, 41, 49, 35, 28, 31, -1, -1,
]
const ARRAY_LS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1]
const ARRAY_LS_MASK = [0n, 0x0000000000100001n, 0x0000000000300003n]
const MASKS = Array.from({ length: 64 }, (_, i) => 1n << BigInt(i))

function bitTransform(table: number[], length: number, source: bigint): bigint {
  let dest = 0n
  for (let i = 0; i < length; i++) {
    const bit = table[i]
    if (bit >= 0 && (source & MASKS[bit]) !== 0n) dest |= MASKS[i]
  }
  return dest
}

function desSubKeys(key: bigint): bigint[] {
  let temp = bitTransform(ARRAY_PC1, 56, key)
  const keys: bigint[] = []
  for (let j = 0; j < 16; j++) {
    const mask = ARRAY_LS_MASK[ARRAY_LS[j]]
    const left = (temp & mask) << BigInt(28 - ARRAY_LS[j])
    const right = (temp & (~mask & ((1n << 64n) - 1n))) >> BigInt(ARRAY_LS[j])
    temp = left | right
    keys.push(bitTransform(ARRAY_PC2, 64, temp))
  }
  return keys
}

function des64(subkeys: bigint[], data: bigint): bigint {
  let out = bitTransform(ARRAY_IP, 64, data)
  let left = out & 0xffffffffn
  let right = (out >> 32n) & 0xffffffffn
  for (let i = 0; i < 16; i++) {
    let r = bitTransform(ARRAY_E, 64, right) ^ subkeys[i]
    let sOut = 0n
    for (let sbi = 7; sbi >= 0; sbi--) {
      const box = Number((r >> BigInt(sbi * 8)) & 0xffn)
      sOut = (sOut << 4n) | BigInt(SBOX[sbi][box])
    }
    const f = bitTransform(ARRAY_P, 32, sOut)
    const next = left ^ f
    left = right
    right = next
  }
  out = ((left << 32n) & 0xffffffff00000000n) | (right & 0xffffffffn)
  return bitTransform(ARRAY_IP1, 64, out)
}

export function kuwoEncrypt(src: Buffer | string): Buffer {
  const bytes = typeof src === 'string' ? Buffer.from(src, 'utf8') : src
  let keyl = 0n
  for (let i = 0; i < 8; i++) keyl |= BigInt(SECRET_KEY[i]) << BigInt(i * 8)
  const subkeys = desSubKeys(keyl)
  const num = Math.floor(bytes.length / 8)
  const blocks: bigint[] = []
  for (let i = 0; i < num; i++) {
    let block = 0n
    for (let j = 0; j < 8; j++) block |= BigInt(bytes[i * 8 + j]) << BigInt(j * 8)
    blocks.push(des64(subkeys, block))
  }
  let tail = 0n
  const rem = bytes.length % 8
  for (let i = 0; i < rem; i++) tail |= BigInt(bytes[num * 8 + i]) << BigInt(i * 8)
  blocks.push(des64(subkeys, tail))
  const result = Buffer.alloc(blocks.length * 8)
  let offset = 0
  for (const block of blocks) {
    for (let j = 0; j < 8; j++) result[offset++] = Number((block >> BigInt(j * 8)) & 0xffn)
  }
  return result
}

export function kuwoEncryptBase64(src: string): string {
  return kuwoEncrypt(src).toString('base64')
}
