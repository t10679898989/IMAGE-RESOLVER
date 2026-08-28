import React, { useState, useEffect, useRef, useTransition } from "react";
import { 
  Upload, 
  Folder, 
  Image as ImageIcon, 
  Trash2, 
  Settings, 
  Play, 
  Pause, 
  RefreshCw, 
  Download, 
  ExternalLink, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  ChevronRight, 
  Sparkles, 
  Copy, 
  Check, 
  Info,
  Layers,
  FileImage,
  HelpCircle,
  ChevronUp,
  ChevronDown
} from "lucide-react";
import { calculateSHA256, computeAverageHash, computeDifferenceHash, computePerceptualHash, loadImage, getHashDistance } from "./imageHasher";
import { UploadedImage, SearchResult, GlobalConfig } from "./types";
import { PublicImagePayload, AdapterSearchResult, ALL_ADAPTERS } from "./lib/searchAdapters";

export default function App() {
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  
  // Pipeline control states
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentProcessingId, setCurrentProcessingId] = useState<string | null>(null);
  const [cooldownRemaining, setCooldownRemaining] = useState<number | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Settings
  const [config, setConfig] = useState<GlobalConfig>({
    expireMinutes: 15,
    autoLoopIntervalMs: 2000,
    autoProcess: true,
    maxSizeMB: 50,
    batchOpenLimit: 10
  });
  const [showConfig, setShowConfig] = useState<boolean>(false);
  const [imgBBApiKey, setImgBBApiKey] = useState<string>(() => sessionStorage.getItem("imgbb_api_key") || localStorage.getItem("imgbb_api_key") || "");
  const [sysConfig, setSysConfig] = useState({ allowUserImgBBKey: true, serverHasImgBBKey: false, isProduction: false });
  const [showImgBBModal, setShowImgBBModal] = useState<boolean>(false);
  const [tempApiKeyInput, setTempApiKeyInput] = useState<string>("");
  const [rememberKey, setRememberKey] = useState<boolean>(false);

  // Sorting state
  const [sortBy, setSortBy] = useState<'default' | 'size-asc' | 'size-desc' | 'res-asc' | 'res-desc'>('default');

  const [isUploadCollapsed, setIsUploadCollapsed] = useState(false);

  // Stats tracker
  const [stats, setStats] = useState({
    sameImageHighResCount: 0
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const activeImageRef = useRef<UploadedImage | null>(null);
  const sortedAndFilteredRef = useRef<UploadedImage[]>([]);

  // Time-ticking effect for expiring URLs
  const [nowTime, setNowTime] = useState<number>(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowTime(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Update stats whenever images change
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => {
        setSysConfig(data);
        const storedKey = sessionStorage.getItem("imgbb_api_key") || localStorage.getItem("imgbb_api_key");
        if (!storedKey) {
          setShowImgBBModal(true);
        }
      })
      .catch(err => {
        console.error("Config fetch error", err);
        const storedKey = sessionStorage.getItem("imgbb_api_key") || localStorage.getItem("imgbb_api_key");
        if (!storedKey) setShowImgBBModal(true);
      });
  }, []);

  const handleSaveImgBBKeyModal = () => {
    setImgBBApiKey(tempApiKeyInput);
    if (rememberKey) {
      localStorage.setItem("imgbb_api_key", tempApiKeyInput);
      sessionStorage.setItem("imgbb_api_key", tempApiKeyInput);
    } else {
      sessionStorage.setItem("imgbb_api_key", tempApiKeyInput);
      localStorage.removeItem("imgbb_api_key");
    }
    setShowImgBBModal(false);
  };

  useEffect(() => {
    let highResCount = 0;

    images.forEach(img => {
      // Check if this image has any search results that are higher-resolution identical images
      const hasHighRes = img.searchResults.some(res => 
        res.isSameImage && 
        res.foundImageUrl && 
        ((res.width && res.width > img.width) || (res.height && res.height > img.height))
      );
      if (hasHighRes) highResCount++;
    });

    setStats({
      sameImageHighResCount: highResCount
    });
  }, [images]);

  // Copy helper
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedText(label);
    setTimeout(() => setCopiedText(null), 2000);
  };

  // Convert File object to Base64 string
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = error => reject(error);
    });
  };

  // Handle files adding
  const addFiles = async (filesList: FileList | File[]) => {
    const filteredFiles = Array.from(filesList).filter(file => file.type.startsWith("image/"));
    if (filteredFiles.length === 0) return;

    const newUploadedImages: UploadedImage[] = [];

    for (let i = 0; i < filteredFiles.length; i++) {
      const file = filteredFiles[i];
      try {
        const base64 = await fileToBase64(file);
        
        let width = 0;
        let height = 0;
        try {
          const htmlImg = await loadImage(base64);
          width = htmlImg.naturalWidth || htmlImg.width || 0;
          height = htmlImg.naturalHeight || htmlImg.height || 0;
        } catch (imgError) {
          console.error("Failed to load image resolution during add:", imgError);
        }

        // Generate placeholder item with pre-loaded dimensions
        const newImg: UploadedImage = {
          id: Math.random().toString(36).slice(2, 11),
          name: file.name,
          base64: base64,
          size: file.size,
          width: width,
          height: height,
          sha256: "",
          aHash: "",
          pHash: "",
          dHash: "",
          status: "pending",
          searchResults: []
        };
        newUploadedImages.push(newImg);
      } catch (err) {
        console.error("Error loading image file:", err);
      }
    }

    setImages(prev => {
      const updated = [...prev, ...newUploadedImages];
      // Select first added if none is selected
      if (!selectedId && updated.length > 0) {
        setSelectedId(updated[prev.length || 0].id);
      }
      return updated;
    });
  };

  // Drag and Drop folder/file parsing
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await addFiles(e.dataTransfer.files);
    }
  };

  const triggerFileSelect = () => fileInputRef.current?.click();
  const triggerFolderSelect = () => folderInputRef.current?.click();

  // Core Processing Engine Step-by-Step for ONE Image
  const processImageById = async (id: string) => {
    const currentImage = images.find(img => img.id === id);
    if (!currentImage) {
      setIsProcessing(false);
      setCurrentProcessingId(null);
      return;
    }

    // Automatically select the active image to show on the right details panel
    setSelectedId(id);

    // 1. Mark as hashes calculating
    updateImageState(currentImage.id, { status: "analyzing" });

    try {
      // Load Image in canvas to calculate dimensions and hashes
      const htmlImg = await loadImage(currentImage.base64);
      const sha256 = await calculateSHA256(currentImage.base64);
      const aHash = computeAverageHash(htmlImg);
      const dHash = computeDifferenceHash(htmlImg);
      const pHash = computePerceptualHash(htmlImg);
      const width = htmlImg.naturalWidth;
      const height = htmlImg.naturalHeight;

      updateImageState(currentImage.id, {
        sha256,
        aHash,
        dHash,
        pHash,
        width,
        height,
      });

      // 2. Generate upload temp URL
      updateImageState(currentImage.id, { status: "uploading" });

      // Send to server to store as temporary accessible link (10~30 mins)
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: currentImage.base64,
          filename: currentImage.name,
          mimeType: currentImage.base64.match(/data:([^;]+);base64/)?.[1] || "image/png",
          expireMinutes: config.expireMinutes,
          imgbbApiKey: imgBBApiKey
        })
      });

      if (!uploadRes.ok) {
        throw new Error("Could not upload to server to establish expiring public URL");
      }

      const uploadData = await uploadRes.json();
      const tempUrl = uploadData.tempUrl;
      const expireAt = uploadData.expireAt;

      updateImageState(currentImage.id, {
        tempUrl,
        expireAt,
        status: "searching",
        currentEngine: "Google",
        searchProgress: 10
      });

      // 3. Initiate Automated Multi-Engine Reverse Search via Adapters
      let searchResults: SearchResult[] = [];
      const payload: PublicImagePayload = {
        imageId: currentImage.id,
        originalFilename: currentImage.name,
        sha256,
        phash: pHash,
        dhash: dHash,
        width,
        height,
        fileSize: currentImage.size,
        publicUrl: tempUrl,
        expiresAt: expireAt.toString(),
      };

      // Run sequential searching via adapters:
      for (let i = 0; i < ALL_ADAPTERS.length; i++) {
        const adapter = ALL_ADAPTERS[i];
        updateImageState(currentImage.id, {
          status: "searching",
          currentEngine: adapter.engineName,
          searchProgress: Math.round(((i + 1) / ALL_ADAPTERS.length) * 100)
        });
        
        try {
          const adapterResult = await adapter.search(payload);

          // Handle manual link adapter result
          if (adapterResult.status === "manual_required" || adapterResult.status === "unsupported" || adapterResult.status === "service_down" || adapterResult.status === "blocked") {
            const manualTitle = adapterResult.status === "unsupported" 
              ? `${adapter.engineName} (Unsupported)` 
              : adapterResult.status === "service_down"
                ? `${adapter.engineName} (Service Down)`
                : adapterResult.status === "blocked"
                  ? `${adapter.engineName} (Blocked / Rate Limit)`
                  : `${adapter.engineName} (Manual Required)`;

            searchResults.push({
              engine: adapterResult.engine,
              url: adapterResult.searchPageUrl || "",
              title: manualTitle,
              foundImageUrl: "",
              isSameImage: false,
              isSimilar: false,
              platform: adapterResult.engine,
              isManualLink: true,
              adapterMode: adapterResult.capability.mode,
              isServiceDown: adapterResult.status === "service_down",
              isBlocked: adapterResult.status === "blocked"
            });
          }
          
          // Map candidate results to SearchResult
          if (adapterResult.candidates && adapterResult.candidates.length > 0) {
            const mappedResults: SearchResult[] = adapterResult.candidates.map(ar => ({
              engine: adapterResult.engine,
              url: ar.candidateUrl,
              title: ar.title || adapterResult.engine,
              foundImageUrl: ar.thumbnailUrl || "",
              width: ar.width,
              height: ar.height,
              resolutionText: (ar as any).resolutionText,
              score: ar.similarity ? ar.similarity * 100 : undefined,
              isSameImage: ar.similarity ? ar.similarity > 0.8 : true, // more lenient since we trust the engine's list
              isSimilar: ar.similarity ? ar.similarity > 0.4 : true,
              platform: adapterResult.engine,
              isManualLink: false,
              adapterMode: adapterResult.capability.mode
            }));
            searchResults = [...searchResults, ...mappedResults];
          }
        } catch (e) {
          console.error(`Adapter ${adapter.engineName} failed:`, e);
        }
        
        // Brief artificial delay for UI aesthetic progression
        await new Promise(resolve => setTimeout(resolve, 300));
      }

      // 4. Organize Candidate Results directly (no extra hashing)
      const verifiedResults: SearchResult[] = [];
      updateImageState(currentImage.id, {
        status: "searching",
        currentEngine: "整理搜尋結果中",
        searchProgress: 95
      });

      for (let k = 0; k < searchResults.length; k++) {
        const res = searchResults[k];
        if (res.foundImageUrl && !res.isManualLink) {
             let isSame = false;
             // Rely purely on the web parsed similarity and engine trust to establish isSameImage
             if (res.score && res.score > 80) isSame = true;
             else if (!res.score && res.width && res.height) isSame = true; // lenient fallback for engines without explicit similarity

             verifiedResults.push({
               ...res,
               isSameImage: isSame,
               isSimilar: !isSame && (res.score ? res.score > 40 : true),
               title: res.score ? `${res.title} (相似度: ${Math.round(res.score)}%)` : res.title
             });
        } else {
          verifiedResults.push(res);
        }
      }

      // Sort verified results:
      // Green (Normal matches), Yellow (Blocked), Gray (Manual), Red (Service Down)
      verifiedResults.sort((a, b) => {
        const getScore = (r: SearchResult) => {
          if (r.isSameImage || r.isSimilar || (!r.isBlocked && !r.isServiceDown && !r.isManualLink)) return 1;
          if (r.isBlocked) return 2; // Yellow
          if (r.isManualLink) return 3; // Gray
          if (r.isServiceDown) return 4; // Red
          return 5;
        };
        return getScore(a) - getScore(b);
      });

      // Check for same resolution original images
      // Find highest resolution and lock it as selectedMatchUrl
      let maxPixels = width * height;
      let selectedUrl: string | undefined = undefined;

      verifiedResults.forEach(res => {
        if (res.isSameImage && res.foundImageUrl) {
          const resW = res.width || 0;
          const resH = res.height || 0;
          const totalPix = resW * resH;
          if (totalPix > maxPixels || (totalPix === maxPixels && !selectedUrl)) {
            maxPixels = totalPix;
            selectedUrl = res.url || res.foundImageUrl; // prefer source page url for direct context
          }
        }
      });

      updateImageState(currentImage.id, {
        searchResults: verifiedResults,
        selectedMatchUrl: selectedUrl,
        status: "completed",
        currentEngine: undefined,
        searchProgress: undefined
      });

    } catch (err: any) {
      console.error("Pipeline failure for image id:", id, err);
      updateImageState(currentImage.id, {
        status: "failed",
        error: err.message || "An unknown error halted the pipeline"
      });
    }
  };

  // Helper helper to modify specific image's state
  const updateImageState = (id: string, updates: Partial<UploadedImage>) => {
    setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
  };

  // Synchronize selection with currently processing image immediately
  useEffect(() => {
    if (isProcessing && currentProcessingId) {
      setSelectedId(currentProcessingId);
    }
  }, [currentProcessingId, isProcessing]);

  // Pipeline execution loop
  useEffect(() => {
    if (!isProcessing || !currentProcessingId) return;

    let isEffectActive = true;
    let timerId: NodeJS.Timeout;
    let countdownIntervalId: NodeJS.Timeout;

    // Trigger single image calculation
    processImageById(currentProcessingId).then(() => {
      if (!isEffectActive) return;

      const latestSorted = sortedAndFilteredRef.current;
      
      // Find the first pending image in the sorted list
      const nextPending = latestSorted.find(img => img.status === "pending");

      if (nextPending) {
        // Start cooldown countdown
        let remainingBase = Math.ceil(config.autoLoopIntervalMs / 1000);
        if (remainingBase > 0) {
          setCooldownRemaining(remainingBase);
          countdownIntervalId = setInterval(() => {
            setCooldownRemaining(prev => {
              if (prev === null || prev <= 1) {
                clearInterval(countdownIntervalId);
                return null;
              }
              return prev - 1;
            });
          }, 1000);
        }

        timerId = setTimeout(() => {
          if (!isEffectActive) return;
          clearInterval(countdownIntervalId);
          setCooldownRemaining(null);
          setCurrentProcessingId(nextPending.id);
        }, config.autoLoopIntervalMs);
      } else {
        setIsProcessing(false);
        setCurrentProcessingId(null);
        setCooldownRemaining(null);
      }
    });

    return () => {
      isEffectActive = false;
      if (timerId) clearTimeout(timerId);
      if (countdownIntervalId) clearInterval(countdownIntervalId);
    };
  }, [currentProcessingId, isProcessing, config.autoLoopIntervalMs]);

  // Start processing loop
  const handleStartPipeline = () => {
    if (sortedAndFilteredImages.length === 0) return;
    
    setIsUploadCollapsed(true);
    let targetId = currentProcessingId;
    
    // If not currently processing any valid ID, look for the first pending
    if (!targetId || !sortedAndFilteredImages.some(img => img.id === targetId && img.status === "pending")) {
      const firstPending = sortedAndFilteredImages.find(img => img.status === "pending");
      if (firstPending) {
        targetId = firstPending.id;
      } else {
        // Re-run all that fit the size limit
        setImages(prev => prev.map(img => {
          if ((img.size / (1024 * 1024)) <= config.maxSizeMB) {
            return { ...img, status: "pending", searchResults: [], selectedMatchUrl: undefined };
          }
          return img;
        }));
        const firstImg = sortedAndFilteredImages[0];
        targetId = firstImg ? firstImg.id : null;
      }
    }
    
    setCurrentProcessingId(targetId);
    setIsProcessing(true);
  };

  // Pause pipeline
  const handlePausePipeline = () => {
    setIsProcessing(false);
  };

  // Restart single image pipeline
  const handleReprocess = (id: string) => {
    const idx = images.findIndex(img => img.id === id);
    if (idx === -1) return;
    updateImageState(id, { status: "pending", searchResults: [], selectedMatchUrl: undefined });
    
    if (!isProcessing) {
      setCurrentProcessingId(id);
      setIsProcessing(true);
    }
  };

  // Remove individual file from list
  const handleRemoveImage = (id: string) => {
    setImages(prev => prev.filter(img => img.id !== id));
    if (selectedId === id) {
      setSelectedId(null);
    }
  };

  const handleClearAll = () => {
    setImages([]);
    setSelectedId(null);
    setIsProcessing(false);
    setCurrentProcessingId(null);
  };

  const selectedImage = images.find(img => img.id === selectedId);

  // Status priorites: active processing/searching first, completed last
  const getStatusPriority = (status: UploadedImage["status"]) => {
    if (["searching", "analyzing", "uploading"].includes(status)) {
      return 0; // Top row
    }
    if (status === "pending" || status === "failed") {
      return 1; // Middle row
    }
    return 2; // Bottom row
  };

  const sortedAndFilteredImages = [...images]
    .filter(img => (img.size / (1024 * 1024)) <= config.maxSizeMB)
    .sort((a, b) => {
      // 1. Prioritize active searching / completed status groupings
      const prioA = getStatusPriority(a.status);
      const prioB = getStatusPriority(b.status);
      if (prioA !== prioB) {
        return prioA - prioB;
      }

      // 2. Custom sorting tie-breaker
      if (sortBy === "size-asc") {
        return a.size - b.size;
      }
      if (sortBy === "size-desc") {
        return b.size - a.size;
      }
      if (sortBy === "res-asc") {
        return (a.width * a.height) - (b.width * b.height);
      }
      if (sortBy === "res-desc") {
        return (b.width * b.height) - (a.width * a.height);
      }
      
      // Default sorting behavior:
      const getSortMetrics = (img: UploadedImage) => {
        let sameCount = 0;
        let maxScore = 0;
        if (img.searchResults) {
          img.searchResults.forEach(res => {
            if (res.isSameImage) {
              sameCount++;
              if (res.score && res.score > maxScore) {
                maxScore = res.score;
              }
            }
          });
        }
        return { sameCount, maxScore, size: img.width * img.height };
      };

      const metricsA = getSortMetrics(a);
      const metricsB = getSortMetrics(b);
      
      if (metricsB.sameCount !== metricsA.sameCount) {
        return metricsB.sameCount - metricsA.sameCount; // Descending count
      }
      if (metricsB.maxScore !== metricsA.maxScore) {
        return metricsB.maxScore - metricsA.maxScore; // Descending max score
      }
      if (metricsB.size !== metricsA.size) {
        return metricsB.size - metricsA.size; // Descending size
      }

      return 0; // Original order fallback
    });

  sortedAndFilteredRef.current = sortedAndFilteredImages;

  // Directly construct launch search URLs for engines given dynamic temp public URL
  const launchAllSearches = (item: UploadedImage) => {
    if (!item.tempUrl) return;
    const url = item.tempUrl;
    
    // Open in separate windows automatically with slight stagger
    const urls = [
      { name: "Google Lens", link: `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(url)}` },
      { name: "SauceNAO", link: `https://saucenao.com/search.php?url=${encodeURIComponent(url)}` },
      { name: "TinEye", link: `https://tineye.com/search?url=${encodeURIComponent(url)}` },
      { name: "Danbooru", link: `https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(url)}` },
      { name: "iqdb", link: `https://iqdb.org/?url=${encodeURIComponent(url)}` },
      { name: "Yandex", link: `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(url)}` },
      { name: "ascii2d", link: `https://ascii2d.net/search/url/${encodeURIComponent(url)}` }
    ];

    let blocked = false;
    urls.forEach((u) => {
      const newWin = window.open(u.link, "_blank");
      if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
        blocked = true;
      }
    });

    if (blocked) {
      alert("⚠️ 發現瀏覽器阻擋了多重視窗彈出！\n\n因為「一鍵開啟」需要同時開啟多個新分頁，請至瀏覽器網址列右方（或設定中）【允許本網站的彈出式視窗與重新導向】，設定完畢後即可正常使用。");
    }
  };

  // Download high-resolution image directly
  const handleDownloadFile = async (url: string, filename: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const dLink = document.createElement("a");
      dLink.href = URL.createObjectURL(blob);
      dLink.download = `highres_${filename}`;
      document.body.appendChild(dLink);
      dLink.click();
      document.body.removeChild(dLink);
    } catch {
      // Fallback if CORS prevents fetch download - direct open
      window.open(url, "_blank");
    }
  };

  // Trigger opens for found "Same image" sources in batch
  const handleBatchOpenHighRes = async () => {
    const itemsToOpen = sortedAndFilteredImages.filter(img => img.selectedMatchUrl && img.status === "completed" && !img.openedHighRes);
    if (itemsToOpen.length === 0) {
      alert("目前沒有在隊列中等待開啟的最高解析度原圖。");
      return;
    }

    const availableSlots = config.batchOpenLimit || 10;
    const itemsToProcess = itemsToOpen.slice(0, availableSlots);

    itemsToProcess.forEach((item, i) => {
      if (item.selectedMatchUrl) {
        setTimeout(() => {
          window.open(item.selectedMatchUrl!, "_blank");
          updateImageState(item.id, { openedHighRes: true });
        }, i * 350); // Slight delay to avoid popup blocker
      }
    });
  };

  // Open the best similar website for all processed images
  const handleBatchOpenAllSimilar = () => {
    const urlsToOpen: string[] = [];
    sortedAndFilteredImages.forEach(img => {
      if (img.status === "completed" && img.searchResults && img.searchResults.length > 0) {
        // Find the best actual match (skip manual search fallback links)
        const firstValid = img.searchResults.find(res => !res.isManualLink && (res.url || res.foundImageUrl));
        const link = firstValid?.url || firstValid?.foundImageUrl;
        if (link) {
          urlsToOpen.push(link);
        }
      }
    });
    
    if (urlsToOpen.length === 0) {
      alert("目前沒有找到任何確認的相似原圖網站可以開啟。 (或只有手動搜尋頁面)");
      return;
    }
    
    let blocked = false;
    urlsToOpen.forEach((link, i) => {
      setTimeout(() => {
        const newWin = window.open(link, "_blank");
        if (!newWin || newWin.closed || typeof newWin.closed === 'undefined') {
          blocked = true;
        }
        // Only show alert once at the end if blocked
        if (i === urlsToOpen.length - 1 && blocked) {
           alert("⚠️ 發現瀏覽器阻擋了多重視窗彈出！\n\n因為「一鍵開啟所有」需要同時開啟多個新分頁，請至瀏覽器網址列右方（或設定中）【允許本網站的彈出式視窗與重新導向】。");
        }
      }, i * 350);
    });
  };

  return (
    <div className="min-h-screen text-slate-100 p-4 md:p-6 bg-[#0a0d14] custom-scrollbar flex flex-col justify-between">
      
      {/* HEADER BAR */}
      <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-white/5 mb-6 relative z-30">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-indigo-500/10 text-indigo-400 rounded-lg border border-indigo-500/20">
              <Layers className="w-5 h-5" />
            </span>
            <h1 className="text-xl md:text-2xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-200 to-indigo-400 bg-clip-text text-transparent">
              批量以圖手動搜圖中心
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1 pl-1">
            資料夾/批次上傳相片，智能特徵指紋計算 (SHA256/dHash/pHash)，產生超時公網 URL、多引擎自動追蹤高解析度原圖。
          </p>
        </div>

        {/* Action controls */}
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="text-[11px] px-2.5 py-1.5 rounded bg-[#111726] border border-white/10 flex items-center gap-2 shrink-0">
               {imgBBApiKey ? (
                 <><span className="w-2 h-2 rounded-full bg-emerald-500"></span><span className="text-emerald-400 font-medium">User ImgBB Key Active</span></>
               ) : sysConfig.serverHasImgBBKey ? (
                 <><span className="w-2 h-2 rounded-full bg-blue-500"></span><span className="text-blue-400 font-medium">Server ImgBB Key Active</span></>
               ) : (
                 <><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></span><span className="text-red-400 font-medium">ImgBB Key Required</span></>
               )}
          </div>
          
          <button
            id="btn-settings"
            onClick={() => setShowConfig(!showConfig)}
            className={`p-2 rounded-lg border text-slate-300 hover:text-white transition-all flex items-center justify-center gap-1 text-sm ${
              showConfig ? "bg-indigo-600/20 border-indigo-500/40 text-indigo-300" : "bg-[#111726] border-white/5"
            }`}
            title="調整設定"
          >
            <Settings className="w-4 h-4" />
            <span className="hidden md:inline">設定</span>
          </button>
          
          <button
            id="btn-clear-all"
            onClick={handleClearAll}
            disabled={images.length === 0}
            className="px-3.5 py-1.5 rounded-lg bg-red-950/20 hover:bg-red-950/40 border border-red-900/30 text-red-300 text-sm font-medium transition-all flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-4 h-4" />
            <span>清空所有</span>
          </button>
        </div>
      </header>

      {/* BODY WORKSPACE */}
      <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 items-stretch">
        
        {/* SETTINGS CARD DROPDOWN PANEL */}
        {showConfig && (
          <div className="col-span-12 glass-panel p-5 rounded-xl border border-white/10 shadow-2xl relative overflow-hidden animate-in fade-in slide-in-from-top-4 duration-200 mb-2">
            <div className="absolute top-0 left-0 w-1.5 h-full bg-indigo-500"></div>
            <div className="flex justify-between items-center mb-4 pl-2">
              <div className="flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-400" />
                <h3 className="font-semibold text-sm text-slate-200">管線設定與過期時間控制</h3>
              </div>
              <button onClick={() => setShowConfig(false)} className="text-slate-400 hover:text-slate-200 text-xs">
                ✕ 關閉
              </button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 pl-2">
              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">外部隨機 URL 有效期限 (10 ~ 30分鐘)</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="10"
                    max="30"
                    value={config.expireMinutes}
                    onChange={(e) => setConfig({ ...config, expireMinutes: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm font-mono bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-400/20 shrink-0">
                    {config.expireMinutes} 分鐘
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">
                  時間過後，伺服器記憶體上對應的 UUID 二進位檔案會自動刪除，保障隱私。
                </span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">批次比對與循環間隔時間</label>
                <div className="flex items-center gap-2">
                  <select
                    value={config.autoLoopIntervalMs}
                    onChange={(e) => setConfig({ ...config, autoLoopIntervalMs: Number(e.target.value) })}
                    className="bg-[#0f1422] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500 w-full"
                  >
                    <option value="1000">1 秒</option>
                    <option value="2000">2 秒 (推薦)</option>
                    <option value="3000">3 秒</option>
                    <option value="5000">5 秒</option>
                    <option value="10000">10 秒</option>
                    <option value="15000">15 秒</option>
                    <option value="20000">20 秒</option>
                  </select>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">每個項目搜圖完成後，冷卻等待以防外部API限流。</span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">是否只顯示該大小以下的圖</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="3"
                    max="50"
                    value={config.maxSizeMB}
                    onChange={(e) => setConfig({ ...config, maxSizeMB: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm font-slate-200 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-400/20 shrink-0">
                    {config.maxSizeMB} MB 以下
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">滑桿範圍 3MB 到 50MB，隱藏不顯示超過設定值的圖檔。</span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">一鍵開啟最清晰原圖上限數量</label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="1"
                    max="50"
                    value={config.batchOpenLimit}
                    onChange={(e) => setConfig({ ...config, batchOpenLimit: Number(e.target.value) })}
                    className="w-full accent-indigo-500 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
                  />
                  <span className="text-sm font-slate-200 bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded border border-indigo-400/20 shrink-0">
                    {config.batchOpenLimit} 個分頁
                  </span>
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">設定一次最多開啟多少個分頁，避免瀏覽器卡頓或遭到攔截。</span>
              </div>

              <div>
                <label className="block text-xs text-slate-400 mb-1.5 font-medium">ImgBB API Key</label>
                <div className="flex items-center gap-2">
                  <input
                    type="password"
                    value={imgBBApiKey}
                    onChange={(e) => setImgBBApiKey(e.target.value)}
                    placeholder="不輸入則不開啟"
                    className="bg-[#0f1422] border border-white/10 rounded-lg px-2 py-1.5 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500 w-full"
                  />
                </div>
                <span className="text-[10px] text-slate-500 mt-1 block">留空則不使用。</span>
              </div>

              <div className="flex items-center">
                <label className="flex items-center gap-2 cursor-pointer user-select-none">
                  <input
                    type="checkbox"
                    checked={config.autoProcess}
                    onChange={(e) => setConfig({ ...config, autoProcess: e.target.checked })}
                    className="w-4 h-4 rounded border-white/10 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
                  />
                  <div className="text-xs">
                    <span className="block text-slate-300 font-medium">添加圖片後自動執行分析</span>
                    <span className="block text-[10px] text-slate-500">上傳拖入檔案立刻自動跑雜湊、上傳、分析、搜尋</span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* LEFT PANEL: UPLOAD AND LIST QUEUE (7 COLS) */}
        <section className="lg:col-span-5 flex flex-col gap-4">
          
          {/* DRAG DROP ZONE */}
          {!isUploadCollapsed ? (
            <div
              id="drag-drop-zone"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="border-2 border-dashed border-white/5 hover:border-indigo-500/40 rounded-xl bg-[#111622]/60 p-6 text-center transition-all cursor-pointer relative group overflow-hidden flex flex-col items-center justify-center min-h-[160px]"
            >
              <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/01 to-indigo-500/0 group-hover:from-indigo-500/5 transition-all"></div>
              
              <div className="p-3 bg-white/5 rounded-full mb-3 text-slate-400 group-hover:text-indigo-400 group-hover:scale-110 transition-all">
                <Upload className="w-6 h-6" />
              </div>

              <h3 className="text-sm font-semibold text-slate-200">
                將圖片或「資料夾」拖曳到此處上傳
              </h3>
              
              <p className="text-xs text-slate-400 mt-1 max-w-[280px] mx-auto leading-relaxed">
                接受資料夾完整丟入，或單獨上傳多張 PNG, JPEG, WEBP 格式圖檔
              </p>

              <div className="flex items-center gap-3 mt-4 relative z-10">
                <button
                  id="btn-upload-file"
                  onClick={triggerFileSelect}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-all shadow-md active:scale-95"
                >
                  選取檔案
                </button>
                <button
                  id="btn-upload-folder"
                  onClick={triggerFolderSelect}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-white/5 transition-all"
                >
                  選取整個資料夾
                </button>
              </div>

              {/* Hidden Inputs */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
                multiple
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={folderInputRef}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
              />
              <button 
                onClick={(e) => { e.stopPropagation(); setIsUploadCollapsed(true); }}
                className="absolute top-3 right-3 p-1.5 hover:bg-white/10 rounded text-slate-400 transition-colors z-20"
                title="收起上傳區塊"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div 
              className="flex items-center justify-between p-3 px-4 rounded-xl border-2 border-dashed border-white/5 bg-[#111622]/40 hover:bg-[#111622]/80 cursor-pointer transition-all"
              onClick={() => setIsUploadCollapsed(false)}
            >
              <div className="flex items-center gap-2 text-slate-400">
                <Upload className="w-4 h-4" />
                <span className="text-sm font-semibold">上傳圖片區塊 (已收攏)</span>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-500" />
              {/* Hidden Inputs */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
                multiple
                accept="image/*"
                className="hidden"
              />
              <input
                type="file"
                ref={folderInputRef}
                onChange={(e) => e.target.files && addFiles(e.target.files)}
                webkitdirectory=""
                directory=""
                multiple
                className="hidden"
              />
            </div>
          )}

          {/* QUEUE STATUS CONTROLLER CARD */}
          <div className="glass-panel p-4 rounded-xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="relative flex h-3 w-3">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isProcessing ? "bg-emerald-400" : "bg-amber-400"}`}></span>
                <span className={`relative inline-flex rounded-full h-3 w-3 ${isProcessing ? "bg-emerald-500" : "bg-amber-500"}`}></span>
              </div>
              <div>
                <div className="text-xs text-slate-400 font-medium">目前的搜圖工作管線</div>
                <div className="text-sm font-bold text-slate-200 mt-0.5">
                  {images.length === 0 
                    ? "佇列為空 (無上傳)" 
                    : cooldownRemaining !== null 
                      ? `⏳ 任務已完成，冷卻倒數中 ${cooldownRemaining}s...` 
                      : isProcessing 
                        ? "正在分析與搜圖中..." 
                        : "管線暫停 / 就緒"}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isProcessing ? (
                <button
                  id="btn-pipeline-pause"
                  onClick={handlePausePipeline}
                  className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-all flex items-center gap-1.5 shadow-md shadow-amber-900/10 active:scale-95"
                >
                  <Pause className="w-4 h-4" />
                  <span>暫停管線</span>
                </button>
              ) : (
                <button
                  id="btn-pipeline-start"
                  onClick={handleStartPipeline}
                  disabled={images.length === 0}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-xs transition-all flex items-center gap-1.5 shadow-md shadow-indigo-900/20 active:scale-95"
                >
                  <Play className="w-4 h-4" />
                  <span>啟動批次分析</span>
                </button>
              )}
            </div>
          </div>

          {/* QUEUE OVERVIEW STATS */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="bg-[#111726]/85 p-2 rounded-lg border border-white/5 text-center flex flex-col justify-center">
                <span className="block text-[10px] text-slate-400">顯示對象</span>
                <span className="text-sm font-bold text-blue-400">{sortedAndFilteredImages.length} 張</span>
              </div>
              <div className="bg-[#111726]/85 p-2 rounded-lg border border-white/5 text-center flex flex-col justify-center">
                <span className="block text-[10px] text-slate-400">核心處理中</span>
                <span className="text-sm font-bold text-amber-500">
                  {images.filter(img => ["analyzing", "uploading", "searching"].includes(img.status)).length}
                </span>
              </div>
              <div className="bg-[#111726]/85 p-2 rounded-lg border border-white/5 text-center flex flex-col justify-center">
                <span className="block text-[10px] text-slate-400">已處理完成</span>
                <span className="text-sm font-bold text-teal-400">
                  {images.filter(img => img.status === "completed").length}
                </span>
              </div>
              <div className="bg-[#111726]/85 p-2 rounded-lg border border-white/5 text-center flex flex-col justify-center">
                <span className="block text-[10px] text-slate-400">處裡失敗</span>
                <span className="text-sm font-bold text-red-500">
                  {images.filter(img => img.status === "failed").length}
                </span>
              </div>
              {images.some(img => img.status === "completed") ? (
                <button 
                  onClick={handleBatchOpenAllSimilar}
                  className="bg-indigo-600/20 hover:bg-indigo-600/40 p-2 rounded-lg border border-indigo-500/30 flex justify-center items-center transition-colors cursor-pointer group h-full"
                >
                  <span className="text-lg font-bold text-indigo-400 tracking-widest group-hover:text-indigo-300">一鍵抓取</span>
                </button>
              ) : (
                <div className="bg-[#111726]/40 p-2 rounded-lg border border-white/5 text-center flex flex-col justify-center opacity-50">
                   <span className="block text-[10px] text-slate-500">等待搜尋完成</span>
                </div>
              )}
            </div>
          )}

          {/* FLOATING ACTION BOTTOM DASHBAR (IF BATCH CONtains SAME HIGHRES) */}
          {sortedAndFilteredImages.some(img => img.selectedMatchUrl && img.status === "completed" && !img.openedHighRes) && (
            <div className="mt-4 mb-2 p-4 bg-[#111726] rounded-xl border border-white/10 flex flex-col md:flex-row justify-between items-center gap-4 relative overflow-hidden shadow-2xl animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="absolute top-0 bottom-0 left-0 w-2 bg-gradient-to-b from-indigo-500 to-emerald-500"></div>
              
              <div className="pl-2">
                <div className="text-xs text-slate-300 font-semibold flex items-center gap-1">
                  <span>批次原圖開啟控制台</span>
                  <span className="px-1.5 py-0.2 bg-emerald-400 text-black text-[9px] font-bold rounded">Ready</span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 max-w-[500px]">
                  目前已完成批次運算，還有 <strong>{sortedAndFilteredImages.filter(img => img.selectedMatchUrl && img.status === "completed" && !img.openedHighRes).length} 張</strong> 發現大圖等待開啟。點擊按鈕可批次開啟最清晰原圖網頁（每次開啟設定的數量上限：{config.batchOpenLimit || 10}）。
                </p>
              </div>

              <button
                id="btn-batch-download"
                onClick={handleBatchOpenHighRes}
                className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white text-xs font-black transition-all flex items-center gap-2 shadow-lg shadow-emerald-950/20 active:scale-95 cursor-pointer max-w-full relative overflow-hidden group shrink-0"
              >
                <Download className="w-4 h-4 text-white group-hover:scale-110 transition-all" />
                <span>一鍵批次開啟最清晰原圖網頁</span>
              </button>
            </div>
          )}

          {/* UPLOADED QUEUE LIST WRAPPER */}
          <div className="flex-1 min-h-[350px] relative flex flex-col bg-[#0d121f] rounded-xl border border-white/5 overflow-hidden">
            <div className="px-4 py-3 bg-[#111726] border-b border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold px-2 py-0.5 bg-[#172554] text-sky-400 rounded-full">
                  {sortedAndFilteredImages.length}
                </span>
                <h3 className="text-xs font-semibold text-slate-300 tracking-wider uppercase">上傳對象列表</h3>
                {isProcessing && currentProcessingId && (
                  <span className="text-[10px] text-indigo-400 animate-pulse">
                    (正處理第 {images.filter(img => img.status === "completed").length + 1} 張)
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400 whitespace-nowrap">排序:</span>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-[#0c0e17] border border-white/10 rounded px-2 py-1 text-[11px] text-slate-300 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="default">預設排序 </option>
                  <option value="size-asc">檔案大小 (由小到大 升序 ⬆)</option>
                  <option value="size-desc">檔案大小 (由大到小 降序 ⬇)</option>
                  <option value="res-asc">解析度像素 (由低到高 升序 ⬆)</option>
                  <option value="res-desc">解析度像素 (由高到低 降序 ⬇)</option>
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 max-h-[500px]">
              {sortedAndFilteredImages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 py-16">
                  <FileImage className="w-12 h-12 stroke-1 opacity-40 mb-3" />
                  <p className="text-sm font-medium text-slate-400">目前無符合條件的圖片</p>
                  <p className="text-[11px] text-slate-500 mt-1 text-center max-w-[200px]">
                    可能因為檔案大小超過設定限制。可調整上方滑桿。
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {sortedAndFilteredImages.map((img, idx) => {
                    const isSelected = img.id === selectedId;
                    const isCurrent = img.id === currentProcessingId;
                    
                    let statusColor = "bg-slate-700/40 text-slate-400 border-white/5";
                    let statusLabel = "等候中 (Pending)";
                    
                    if (img.status === "analyzing") {
                      statusColor = "bg-blue-600/10 text-blue-400 border-blue-500/20 animate-pulse";
                      statusLabel = "雜湊運算中...";
                    } else if (img.status === "uploading") {
                      statusColor = "bg-purple-600/10 text-purple-400 border-purple-500/20";
                      statusLabel = "產生臨時 URL...";
                    } else if (img.status === "searching") {
                      statusColor = "bg-amber-600/10 text-amber-400 border-amber-500/20";
                      statusLabel = img.currentEngine 
                        ? `搜尋: ${img.currentEngine} (${img.searchProgress || 0}%)` 
                        : "搜尋引擎比對...";
                    } else if (img.status === "completed") {
                      statusColor = "bg-emerald-600/10 text-emerald-400 border-emerald-500/20";
                      statusLabel = "已完成搜尋";
                    } else if (img.status === "failed") {
                      statusColor = "bg-red-600/10 text-red-500 border-red-500/20";
                      statusLabel = "處理失敗";
                    }

                    return (
                      <div
                        key={img.id}
                        id={`queue-item-${img.id}`}
                        onClick={() => setSelectedId(img.id)}
                        className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isSelected 
                            ? "bg-slate-800 border-indigo-500 shadow-lg shadow-black/30" 
                            : isCurrent
                              ? "bg-indigo-950/20 border-indigo-500/25"
                              : "bg-[#111726]/60 border-white/5 hover:bg-[#111726]/90"
                        }`}
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="relative w-12 h-12 rounded bg-black/40 flex-shrink-0 overflow-hidden border border-white/5">
                            <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                            {isCurrent && (
                              <div className="absolute inset-0 bg-indigo-900/40 flex items-center justify-center">
                                <RefreshCw className="w-4 h-4 text-white animate-spin" />
                              </div>
                            )}
                          </div>
                          
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-semibold text-slate-200 truncate pr-2" title={img.name}>
                              {img.name}
                            </h4>
                            <p className="text-[10px] font-mono text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap">
                              <span>
                                {img.size >= 1024 * 1024 
                                  ? `${(img.size / (1024 * 1024)).toFixed(2)} MB` 
                                  : `${(img.size / 1024).toFixed(1)} KB`}
                              </span>
                              <span className="text-slate-500">
                                ({img.width > 0 && img.height > 0 ? `${img.width}x${img.height}` : "解析度讀取中"})
                              </span>
                            </p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {img.searchResults.length > 0 && (
                                <span className="text-[9px] font-medium px-1 rounded bg-indigo-950 text-indigo-400">
                                  {img.searchResults.filter(r => r.isSameImage).length} 個相同原圖
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border ${statusColor} font-semibold font-mono`}>
                            {statusLabel}
                          </span>
                          
                          <div className="flex items-center gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReprocess(img.id);
                              }}
                              className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-indigo-400 transition-all"
                              title="重置並再次呼叫管線"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveImage(img.id);
                              }}
                              className="p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-red-400 transition-all"
                              title="刪除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* RIGHT PANEL: MAIN DETAILED ANALYSIS AND ENGINE LOOKUP (7 COLS) */}
        <section className="lg:col-span-7 flex flex-col gap-6">
          
          {!selectedImage ? (
            <div className="flex-grow flex flex-col items-center justify-center glass-panel p-12 rounded-xl text-slate-500 h-full min-h-[500px]">
              <div className="p-4 bg-white/5 rounded-full mb-4">
                <ImageIcon className="w-12 h-12 opacity-30 text-indigo-400" />
              </div>
              <h3 className="text-base font-bold text-slate-300">尚未選取任何圖片</h3>
              <p className="text-xs text-slate-400 max-w-[300px] text-center mt-2 leading-relaxed">
                請在上傳列表中選取任何一張圖片，即可開始深度特徵運算，生成外部臨時 URL，並串接搜圖平台。
              </p>
            </div>
          ) : (
            <div className="glass-panel p-5 rounded-xl border border-white/5 flex flex-col gap-6">
              
              {/* IMAGE HEADER INFO */}
              <div>
                <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 border-b border-white/5 pb-4">
                  <div className="overflow-hidden">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono tracking-widest bg-indigo-500/15 border border-indigo-500/20 px-2 py-0.5 rounded text-indigo-300 uppercase">
                        選取目標
                      </span>
                      <h2 className="text-sm font-bold text-white truncate max-w-[280px]" title={selectedImage.name}>
                        {selectedImage.name}
                      </h2>
                    </div>
                    <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-2">
                      <span>檔案大小: <strong>
                        {selectedImage.size >= 1024 * 1024 
                          ? `${(selectedImage.size / (1024 * 1024)).toFixed(2)} MB` 
                          : `${(selectedImage.size / 1024).toFixed(1)} KB`}
                      </strong></span>
                      <span className="text-slate-600">•</span>
                      <span>實體尺寸: <strong>{selectedImage.width && selectedImage.height ? `${selectedImage.width} × ${selectedImage.height} px` : "解析度讀取中"}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start sm:self-center">
                    {selectedImage.tempUrl ? (
                      <button
                        onClick={() => launchAllSearches(selectedImage)}
                        className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-semibold text-white transition-all flex items-center gap-1 active:scale-95 shadow-md"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>一鍵開啟所有搜圖平台</span>
                      </button>
                    ) : (
                      <span className="text-[11px] bg-slate-800 text-slate-400 border border-white/5 px-2 py-1.5 rounded-lg flex items-center gap-1.5 font-medium">
                        <Clock className="w-3.5 h-3.5" />
                        等待外部 URL 產生
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-6 mt-4">
                  
                  {/* REALTIME VISUAL PREVIEW & EXPIRE COUNTDOWN */}
                  <div className="md:col-span-5 flex flex-col gap-3">
                    <div className="relative aspect-square rounded-xl bg-black/60 overflow-hidden border border-white/5 group flex items-center justify-center">
                      <img src={selectedImage.base64} alt={selectedImage.name} className="w-full h-full object-contain" />
                      
                    </div>

                    {selectedImage.tempUrl && selectedImage.expireAt && (
                      <div className="p-2.5 rounded bg-slate-900 border border-indigo-500/20 flex items-center justify-center gap-2 text-[11px] text-indigo-300 font-bold font-mono">
                        <Clock className="w-4 h-4 text-indigo-400 animate-pulse" />
                        <span>
                          {(() => {
                            const remain = selectedImage.expireAt - nowTime;
                            if (remain <= 0) return "已過期";
                            const mins = Math.floor(remain / 60000);
                            const secs = Math.floor((remain % 60000) / 1000);
                            return `Temp URL 剩 ${mins}:${secs.toString().padStart(2, "0")}`;
                          })()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* LOGS, CLASSIFICATION AND LOCAL COGNITIVE LOGS */}
                  <div className="md:col-span-7 flex flex-col gap-4">
                    
                    {/* HASH COMPONENT CARD */}
                    <div className="bg-[#111726]/60 rounded-xl border border-white/5 p-4 flex flex-col gap-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-300 font-semibold uppercase tracking-wider">
                        <Sparkles className="w-4 h-4 text-indigo-400" />
                        <span>圖片本地特徵指紋 (Local Fingerprints)</span>
                      </div>

                      <div className="grid grid-cols-1 gap-2 text-xs font-mono">
                        <div className="flex items-center justify-between bg-black/40 p-2 rounded border border-white/5">
                          <div className="overflow-hidden pr-2">
                            <span className="block text-[9px] text-slate-500 uppercase font-bold">SHA-256 (檔案唯指紋)</span>
                            <span className="text-[11px] text-slate-300 truncate block mt-0.5">
                              {selectedImage.sha256 || "等候分析管線執行"}
                            </span>
                          </div>
                          {selectedImage.sha256 && (
                            <button
                              onClick={() => handleCopy(selectedImage.sha256, "sha256")}
                              className="text-slate-400 hover:text-white p-1 hover:bg-slate-800 rounded"
                            >
                              {copiedText === "sha256" ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <div className="bg-black/40 p-2 rounded border border-white/05 relative overflow-hidden">
                            <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1">
                              <span>感知雜湊 (pHash / DCT)</span>
                              <span className="group relative inline-block text-slate-600 hover:text-slate-400 cursor-pointer">
                                <HelpCircle className="w-3 h-3" />
                                <span className="absolute hidden group-hover:block bottom-5 left-1/2 -translate-x-1/2 w-48 bg-slate-900 border border-white/10 p-2 rounded text-[10px] text-slate-400 normal-case leading-relaxed shadow-xl leading-relaxed z-30">
                                  使用離散餘弦變換(DCT)降頻分析，具備角度與亮度的強大抗變形能力
                                </span>
                              </span>
                            </div>
                            <span className="text-11px font-mono font-bold text-slate-200 mt-1 block">
                              {selectedImage.pHash || "等待計算"}
                            </span>
                          </div>

                          <div className="bg-black/40 p-2 rounded border border-white/05">
                            <div className="text-[9px] text-slate-500 font-bold uppercase flex items-center gap-1">
                              <span>差異雜湊 (dHash)</span>
                              <span className="group relative inline-block text-slate-600 hover:text-slate-400 cursor-pointer">
                                <HelpCircle className="w-3 h-3" />
                                <span className="absolute hidden group-hover:block bottom-5 left-1/2 -translate-x-1/2 w-48 bg-slate-900 border border-white/10 p-2 rounded text-[10px] text-slate-400 normal-case leading-relaxed shadow-xl leading-relaxed z-30">
                                  基於水平相鄰像素亮度梯度比對。對極高低解析度縮放比對效果絕佳
                                </span>
                              </span>
                            </div>
                            <span className="text-11px font-mono font-bold text-slate-200 mt-1 block">
                              {selectedImage.dHash || "等待計算"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* EXTERNAL TEMP URL (MOVED FROM LEFT SIDE) */}
                    {selectedImage.tempUrl && (
                      <div className="bg-[#111726]/60 rounded-xl border border-white/5 p-4 flex flex-col gap-2.5">
                        <div className="flex justify-between items-center">
                          <div className="text-xs text-slate-300 font-semibold tracking-wide uppercase flex items-center gap-1.5">
                            <Layers className="w-4 h-4 text-indigo-400" />
                            <span>外部可讀鏈接 URL (過期過後失效)</span>
                          </div>
                        </div>

                        <div className="bg-black/40 rounded p-3 flex justify-between items-center border border-white/5 overflow-hidden">
                          <span className="text-xs font-mono text-indigo-300 truncate" title={selectedImage.tempUrl}>
                            {selectedImage.tempUrl}
                          </span>
                          <button
                            onClick={() => handleCopy(selectedImage.tempUrl || "", "url")}
                            className="p-1.5 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition-all ml-2 flex-shrink-0"
                            title="複製外部可讀網址"
                          >
                            {copiedText === "url" ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                  </div>
                </div>
              </div>

              {/* SEARCH ENGINE MATCHES COMPARISON BOX */}
              <div className="border border-white/5 rounded-xl bg-black/40 overflow-hidden mt-6 min-h-[300px] flex flex-col">
                
                {/* MATCH SUBTITLE SECTION */}
                <div className="px-4 py-3 bg-[#111726]/75 border-b border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-indigo-400" />
                    <h3 className="text-sm font-bold text-slate-100 tracking-wide uppercase">
                      跨引擎深度比對 & 原圖抓取
                    </h3>
                    {selectedImage.selectedMatchUrl && (
                      <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-extrabold bg-emerald-500/10 px-2.5 py-1 rounded-md border border-emerald-500/20 ml-3 shadow-sm tracking-wide">
                        <span className="text-[14px]">👑</span> <span>發現最高解析度原圖</span>
                      </div>
                    )}
                  </div>
                  <div></div>
                </div>

                <div className="p-4 overflow-y-auto custom-scrollbar max-h-[480px]">
                   {selectedImage.status === "pending" || selectedImage.status === "analyzing" || selectedImage.status === "uploading" ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
                      <RefreshCw className="w-8 h-8 opacity-40 mb-2 animate-spin text-indigo-400" />
                      <p className="text-xs">等待自動管線將圖片上傳並計算特徵...</p>
                    </div>
                  ) : selectedImage.status === "searching" ? (
                    <div className="h-full flex flex-col items-center justify-center p-6 text-center py-12">
                      <div className="w-full max-w-xs mb-4">
                        <div className="flex justify-between text-xs mb-2 text-indigo-400 font-semibold tracking-wider font-mono">
                          <span>正在連線比對: {selectedImage.currentEngine || "初始化中"}</span>
                          <span>{selectedImage.searchProgress || 0}%</span>
                        </div>
                        <div className="w-full bg-[#1e293b] rounded-full h-3 border border-white/5 overflow-hidden p-[2px]">
                          <div 
                            className="bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 h-full rounded-full transition-all duration-300" 
                            style={{ width: `${selectedImage.searchProgress || 0}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-xs text-slate-300 font-medium animate-pulse">正在透過多引擎逆向檢星，鎖定最高畫質代碼...</p>
                      <p className="text-[10px] text-slate-500 mt-2 leading-relaxed">
                        目前搜尋順序：Google ⮕ SauceNAO ⮕ TinEye ⮕ danbooru ⮕ iqdb ⮕ Yandex ⮕ ascii2d ⮕ twitter ⮕ facebook
                      </p>
                    </div>
                  ) : selectedImage.searchResults.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12 text-center">
                      <AlertTriangle className="w-8 h-8 text-amber-500 opacity-65 mb-2" />
                      <p className="text-xs text-slate-400 font-semibold">此圖片目前沒有解析到的自動搜圖結果</p>
                      <p className="text-[10px] text-slate-500 max-w-[280px] mt-1 leading-relaxed">
                        可能因為暫未觸發、或該圖片為首創原創畫作。
                        您可使用右上方「一鍵開啟所有搜圖平台」，手動在瀏覽器中開啟這些強大平台二次校對。
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3">
                      
                      {/* HIGH-RES HIGHLIGHT BANNER */}
                      {selectedImage.selectedMatchUrl && (
                        <div className="p-4 py-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 to-indigo-950/30 border border-emerald-500/30 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 shadow-inner">
                          <div>
                            <div className="text-sm font-black text-emerald-300 flex items-center gap-2 mb-1">
                              <span>發現大圖！</span>
                              <span className="text-[11px] bg-emerald-400 text-black font-extrabold px-2 py-0.5 rounded shadow-sm tracking-wide uppercase">Same content</span>
                            </div>
                            <p className="text-xs text-slate-300 mt-0.5 leading-relaxed max-w-xl">
                              演算法已自動過濾「Similar(同色調/同構圖)」，成功比對並在互聯網鎖定了<strong className="text-slate-100 font-extrabold px-1">與原畫百分之百相同</strong>、但解析度更高的原圖：
                            </p>
                          </div>
                          
                          <a
                            href={selectedImage.selectedMatchUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={() => updateImageState(selectedImage.id, { openedHighRes: true })}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-extrabold transition-all shadow-md shadow-emerald-900/20 shrink-0 cursor-pointer active:scale-95"
                          >
                            <Download className="w-4 h-4" />
                            <span>前往原圖 / 下載</span>
                          </a>
                        </div>
                      )}

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-1">
                        {selectedImage.searchResults.map((res, i) => {
                          const isLarger = !res.isManualLink && res.isSameImage && res.foundImageUrl && 
                            ((res.width && res.width > selectedImage.width) || (res.height && res.height > selectedImage.height));
                          
                          return (
                            <div
                              key={i}
                              className={`p-3 rounded-lg border bg-slate-900/40 relative flex flex-col justify-between gap-3 ${
                                res.isServiceDown
                                  ? "border-red-500/40 bg-red-950/20 shadow-md shadow-red-950/10"
                                  : res.isBlocked
                                  ? "border-orange-500/40 bg-orange-950/20 shadow-md shadow-orange-950/10"
                                  : res.isManualLink 
                                  ? "border-slate-700/40 bg-slate-800/10 opacity-75"
                                  : res.isSameImage 
                                  ? isLarger 
                                    ? "border-emerald-500/40 bg-emerald-950/10 shadow-md shadow-emerald-950/10"
                                    : "border-indigo-500/30 bg-indigo-950/5"
                                  : "border-white/5 opacity-80"
                              }`}
                            >
                              <div>
                                <div className="flex justify-between items-start">
                                  {res.isServiceDown ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-red-500/10 text-red-400 border border-red-400/20">
                                      Service Down (服務離線)
                                    </span>
                                  ) : res.isBlocked ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-orange-500/10 text-orange-400 border border-orange-400/20">
                                      Cloudflare Blocked (阻擋自動抓取)
                                    </span>
                                  ) : res.isManualLink ? (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded font-mono font-bold bg-slate-800 text-slate-300 border border-slate-600/30">
                                      {res.adapterMode === "unsupported" ? "Unsupported (不支援)" : "Manual Required (手動開啟)"}
                                    </span>
                                  ) : (
                                    <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono font-bold ${
                                      res.isSameImage 
                                        ? "bg-emerald-500/10 text-emerald-400 border border-emerald-400/20" 
                                        : "bg-indigo-500/10 text-indigo-400 border border-indigo-400/20"
                                    }`}>
                                      {res.isSameImage ? "Auto: Same Image (自動對比相同)" : "Auto: Similar Image (自動對比相似)"}
                                    </span>
                                  )}

                                  <span className={`text-sm px-3.5 py-1.5 rounded-lg border-2 font-bold tracking-wide shadow-sm flex items-center justify-center ${
                                    res.engine.toLowerCase() === 'google' ? 'bg-red-500/10 text-red-500 border-red-500/30' :
                                    res.engine.toLowerCase() === 'yandex' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' :
                                    res.engine.toLowerCase() === 'saucenao' ? 'bg-amber-500/10 text-amber-500 border-amber-500/30' :
                                    res.engine.toLowerCase() === 'tineye' ? 'bg-blue-500/10 text-blue-400 border-blue-500/30' :
                                    res.engine.toLowerCase() === 'ascii2d' ? 'bg-pink-500/10 text-pink-500 border-pink-500/30' :
                                    res.engine.toLowerCase() === 'iqdb' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30' :
                                    res.engine.toLowerCase() === 'danbooru' ? 'bg-[#3e5dfd]/10 text-[#607dff] border-[#3e5dfd]/30' :
                                    'bg-slate-500/10 text-slate-400 border-slate-500/30'
                                  }`}>
                                    {res.engine}
                                  </span>
                                </div>

                                <h4 className={`text-xs font-bold mt-2 truncate line-clamp-1 ${res.isBlocked ? "text-orange-300" : res.isServiceDown ? "text-red-300" : res.isManualLink ? "text-slate-400" : "text-slate-200"}`}>
                                  {res.title}
                                </h4>

                                <div className="text-[11px] text-slate-400 mt-1 flex flex-col gap-0.5 font-sans">
                                  {res.resolutionText && (
                                    <span className="block">
                                      解析度: <strong className={isLarger ? "text-emerald-400 font-bold" : "text-slate-300"}>
                                        {res.resolutionText}
                                      </strong>
                                      {isLarger && " (超過原圖解析度 ✓)"}
                                    </span>
                                  )}
                                  {!res.isManualLink && res.platform && (
                                    <span className="block">來源: <strong>{res.platform}</strong></span>
                                  )}
                                  {res.isManualLink && res.adapterMode && (
                                    <span className="block text-[10px] mt-1 italic text-slate-500">
                                      Mode: {res.adapterMode}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 justify-end mt-2">
                                <a
                                  href={res.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className={`px-2 py-1 rounded text-[10px] transition-all flex items-center gap-1 ${
                                    res.isBlocked
                                    ? "bg-orange-900/30 text-orange-300 border border-orange-500/30 hover:bg-orange-900/50"
                                    : res.isServiceDown
                                    ? "bg-red-900/30 text-red-300 border border-red-500/30 hover:bg-red-900/50"
                                    : res.isManualLink 
                                    ? "bg-slate-700/50 hover:bg-slate-600 text-slate-300 border border-slate-600/50" 
                                    : "bg-[#111726]/80 text-indigo-300 hover:text-white border border-white/5 hover:border-indigo-400/30"
                                  }`}
                                >
                                  <span>{res.isManualLink ? "前往手動搜尋" : "查看結果網頁"}</span>
                                  <ExternalLink className="w-2.5 h-2.5" />
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                    </div>
                  )}
                </div>

                {/* SEARCH ENGINES OUTDOOR LAUNCHER QUICKLINKS LIST */}
                {selectedImage.tempUrl && (
                  <div className="p-3 bg-[#111726]/90 border-t border-white/5 flex flex-col gap-2">
                    <span className="text-[9px] text-slate-400 uppercase font-mono tracking-wider font-semibold">
                      快速開啟手動搜圖列表 (直接帶入外部可讀鏈接 URL)
                    </span>
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-red-500/10 hover:bg-red-500/20 text-red-500 hover:text-red-400 border border-red-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        Google Search
                      </a>
                      <a
                        href={`https://saucenao.com/search.php?url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 hover:text-amber-400 border border-amber-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        SauceNAO
                      </a>
                      <a
                        href={`https://tineye.com/search?url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 hover:text-blue-300 border border-blue-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        TinEye
                      </a>
                      <a
                        href={`https://danbooru.donmai.us/iqdb_queries?url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-[#3e5dfd]/10 hover:bg-[#3e5dfd]/20 text-[#607dff] hover:text-[#839aff] border border-[#3e5dfd]/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        Danbooru
                      </a>
                      <a
                        href={`https://iqdb.org/?url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 hover:text-emerald-400 border border-emerald-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        iqdb
                      </a>
                      <a
                        href={`https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-500 hover:text-yellow-400 border border-yellow-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        Yandex
                      </a>
                      <a
                        href={`https://ascii2d.net/search/url/${encodeURIComponent(selectedImage.tempUrl)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs bg-pink-500/10 hover:bg-pink-500/20 text-pink-500 hover:text-pink-400 border border-pink-500/30 px-3 py-1.5 rounded-lg font-bold transition-all"
                      >
                        ascii2d
                      </a>
                    </div>
                  </div>
                )}

              </div>

            </div>
          )}
        </section>
      </main>

      {/* IMGBB STARTUP MODAL */}
      {showImgBBModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-[#111726] border border-indigo-500/30 rounded-xl p-6 max-w-lg w-full shadow-2xl relative overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="absolute top-0 left-0 w-full h-1 bg-indigo-500"></div>
            <h2 className="text-xl font-bold text-white mb-3">歡迎使用批量以圖手動搜圖中心</h2>
            <p className="text-sm text-slate-300 mb-4 leading-relaxed">
              本搜圖是使用第三方公開網站 ◎ imgBB 的方式，使用者建立或登入帳號輸入API Key後，圖片會限時上傳至ImgBB，時間到會自動銷毀，本網站也堅決後端不保存、不記錄、不回傳 key
            </p>
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-400 mb-1">ImgBB API Key</label>
              <input 
                type="password"
                className="w-full bg-[#0c0f16] border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
                placeholder="輸入您的 API Key..."
                value={tempApiKeyInput}
                onChange={(e) => setTempApiKeyInput(e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 mb-6 cursor-pointer">
              <input 
                type="checkbox"
                className="w-4 h-4 rounded border-white/10 text-indigo-600 focus:ring-indigo-500 bg-slate-900"
                checked={rememberKey}
                onChange={(e) => setRememberKey(e.target.checked)}
              />
              <span className="text-sm text-slate-300">是否記住此網站</span>
            </label>
            <div className="flex justify-end gap-3">
              <button 
                onClick={() => setShowImgBBModal(false)}
                className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-slate-300 transition-colors"
               >
                關閉
              </button>
              <button 
                 onClick={handleSaveImgBBKeyModal}
                 className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-sm text-white font-medium transition-colors cursor-pointer"
                >
                確認並儲存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
