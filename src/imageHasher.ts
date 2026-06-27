/**
 * Client-side high performance image hashing utilities
 * Computes SHA-256, Average Hash (aHash), Difference Hash (dHash) and Perceptual Hash (pHash) with 100% pure JS/Canvas.
 */

// Load image from base64 safely
export function loadImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = base64;
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(new Error("Failed to load image for hashing"));
  });
}

// Compute SHA-256 using browser local Web Crypto API
export async function calculateSHA256(base64: string): Promise<string> {
  // Extract binary data from base64
  const base64Data = base64.split(",")[1] || base64;
  const binaryString = atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes.buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Convert 64-bit boolean array to 16-character hex string
function bitsToHex(bits: boolean[]): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    let num = 0;
    if (bits[i]) num += 8;
    if (bits[i + 1]) num += 4;
    if (bits[i + 2]) num += 2;
    if (bits[i + 3]) num += 1;
    hex += num.toString(16);
  }
  return hex;
}

// Computes Average Hash (aHash): 8x8 resizing -> grayscale -> median comparison
export function computeAverageHash(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "0000000000000000";
  
  ctx.drawImage(img, 0, 0, 8, 8);
  const imgData = ctx.getImageData(0, 0, 8, 8);
  const data = imgData.data;
  
  // Grayscale and Average calculation
  const grayscale: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) {
    // Standard luminance weights: 0.299R + 0.587G + 0.114B
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    grayscale.push(gray);
    sum += gray;
  }
  
  const average = sum / 64;
  const bits = grayscale.map((g) => g >= average);
  return bitsToHex(bits);
}

// Computes Difference Hash (dHash): 9x8 resizing -> horizontal gradient direction
export function computeDifferenceHash(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = 9;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "0000000000000000";
  
  ctx.drawImage(img, 0, 0, 9, 8);
  const imgData = ctx.getImageData(0, 0, 9, 8);
  const data = imgData.data;
  
  const grayscale: number[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: number[] = [];
    for (let x = 0; x < 9; x++) {
      const idx = (y * 9 + x) * 4;
      const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      row.push(gray);
    }
    grayscale.push(row);
  }
  
  const bits: boolean[] = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Comparison: left pixel vs right pixel
      bits.push(grayscale[y][x] > grayscale[y][x + 1]);
    }
  }
  
  return bitsToHex(bits);
}

// 1D DCT helper used for 2D DCT calculation on rows and columns
function performDCT1D(vector: number[]): number[] {
  const N = vector.length;
  const result = new Array(N).fill(0);
  for (let u = 0; u < N; u++) {
    let sum = 0;
    for (let x = 0; x < N; x++) {
      sum += vector[x] * Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N));
    }
    const c = u === 0 ? Math.sqrt(1 / N) : Math.sqrt(2 / N);
    result[u] = sum * c;
  }
  return result;
}

// Computes standard Perceptual Hash (pHash): Resizing to 32x32 -> 2D DCT -> taking upper-left 8x8 -> median thresholding
export function computePerceptualHash(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 32;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "0000000000000000";
  
  ctx.drawImage(img, 0, 0, 32, 32);
  const imgData = ctx.getImageData(0, 0, 32, 32);
  const data = imgData.data;
  
  // Create 32x32 matrix of grayscales
  const matrix: number[][] = [];
  for (let y = 0; y < 32; y++) {
    const row: number[] = [];
    for (let x = 0; x < 32; x++) {
      const idx = (y * 32 + x) * 4;
      const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      row.push(gray);
    }
    matrix.push(row);
  }
  
  // Transform rows using 1D DCT
  const rowTransformed: number[][] = [];
  for (let y = 0; y < 32; y++) {
    rowTransformed.push(performDCT1D(matrix[y]));
  }
  
  // Transform columns using 1D DCT to get full 2D DCT matrix
  const dct2D: number[][] = Array.from({ length: 32 }, () => new Array(32).fill(0));
  for (let x = 0; x < 32; x++) {
    const col: number[] = [];
    for (let y = 0; y < 32; y++) {
      col.push(rowTransformed[y][x]);
    }
    const colTransformed = performDCT1D(col);
    for (let y = 0; y < 32; y++) {
      dct2D[y][x] = colTransformed[y];
    }
  }
  
  // Get upper-left 8x8 DCT coefficients, ignoring the DC coefficient (0, 0)
  const dct8x8: number[] = [];
  let sum = 0;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // Ignore DC coefficient
      if (y === 0 && x === 0) continue;
      const val = dct2D[y][x];
      dct8x8.push(val);
      sum += val;
    }
  }
  
  const average = sum / dct8x8.length;
  // Compare DCT elements to mean (or median, average is solid) to form binary array
  const bits = dct8x8.map((val) => val >= average);
  
  // Pad the 63 bits to 64 with a trailing false
  bits.push(false);
  
  return bitsToHex(bits);
}

// Calculate similarity of two Hex Hashes (Hamming Distance ratio)
export function getHashDistance(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 0;
  let matches = 0;
  for (let i = 0; i < hash1.length; i++) {
    const h1 = parseInt(hash1[i], 16).toString(2).padStart(4, "0");
    const h2 = parseInt(hash2[i], 16).toString(2).padStart(4, "0");
    for (let j = 0; j < 4; j++) {
      if (h1[j] === h2[j]) {
        matches++;
      }
    }
  }
  return matches / (hash1.length * 4); // percentage of similarity
}
