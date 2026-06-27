export interface SearchResult {
  engine: string;
  url: string; // URL where the search can be viewed
  title: string;
  foundImageUrl: string; // Direct image URL found of the image (empty if manual)
  width?: number;
  height?: number;
  resolutionText?: string; // e.g. 1920x1080
  score?: number; // matching metric or similarity score
  isSameImage: boolean; // Same content, potentially higher resolution
  isSimilar: boolean;  // Similar but different (color, composition, etc.)
  platform?: string; // Twitter, Pixiv, Facebook, etc.
  isManualLink?: boolean;
  adapterMode?: string;
  isServiceDown?: boolean;
  isBlocked?: boolean;
}

export interface UploadedImage {
  id: string;
  name: string;
  base64: string;
  size: number;
  width: number;
  height: number;
  sha256: string;
  aHash: string;
  pHash: string;
  dHash: string;
  classificationRaw?: string; // full feedback from AI
  tempUrl?: string; // The expiring public URL
  expireAt?: number; // millisecond timestamp
  status: 'pending' | 'analyzing' | 'uploading' | 'searching' | 'completed' | 'failed';
  error?: string;
  searchResults: SearchResult[];
  selectedMatchUrl?: string;
  currentEngine?: string;
  searchProgress?: number;
  openedHighRes?: boolean;
}

export interface GlobalConfig {
  expireMinutes: number; // 10 to 30 mins
  autoLoopIntervalMs: number;
  autoProcess: boolean;
  maxSizeMB: number; // 3 to 50 MB
  batchOpenLimit: number;
}
