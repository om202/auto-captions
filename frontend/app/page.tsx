'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyB28a9zW5q3WahH-a4Cbo_2k-T28IAFiK4",
  authDomain: "auto-subtitle-maker.firebaseapp.com",
  projectId: "auto-subtitle-maker",
  storageBucket: "auto-subtitle-maker.firebasestorage.app",
  messagingSenderId: "556655406296",
  appId: "1:556655406296:web:770cf312f0e82c16f4bbad",
  measurementId: "G-THEK7CGHXP"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);

interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textColor: string;
  outlineColor: string;
  outlineWidth: number;
  highlightColor: string;
  verticalPosition: number;
  textTransform: 'uppercase' | 'lowercase' | 'capitalize' | 'none';
  opacity: number;
  shadow: boolean;
}

const FONTS = [
  { name: 'Modern Sans', value: 'Inter, system-ui, sans-serif' },
  { name: 'Impact', value: 'Impact, Haettenschweiler, sans-serif' },
  { name: 'Classic Serif', value: 'Georgia, serif' },
  { name: 'Monospace', value: 'Courier New, monospace' },
  { name: 'Comic', value: 'Comic Sans MS, cursive, sans-serif' },
];

const PRESETS = {
  viral: {
    fontFamily: 'Impact, Haettenschweiler, sans-serif',
    fontSize: 48,
    fontWeight: '900',
    textColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    highlightColor: '#FACC15', // Yellow-400
    verticalPosition: 80,
    textTransform: 'uppercase',
    opacity: 1,
    shadow: true,
  } as SubtitleStyle,
  clean: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 24,
    fontWeight: '500',
    textColor: '#FFFFFF',
    outlineColor: 'transparent',
    outlineWidth: 0,
    highlightColor: '#FFFFFF',
    verticalPosition: 90,
    textTransform: 'none',
    opacity: 0.9,
    shadow: true,
  } as SubtitleStyle,
};

export default function Home() {
  // Core State
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  
  // Data State
  const [wordLevelSubtitles, setWordLevelSubtitles] = useState<any[]>([]);
  const [phraseSubtitles, setPhraseSubtitles] = useState<any[]>([]);
  const [srtUrl, setSrtUrl] = useState('');
  const [debugInfo, setDebugInfo] = useState<any>(null);
  
  // Player State
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Editor State
  const [viewMode, setViewMode] = useState<'word' | 'phrase'>('phrase');
  const [wordsPerCaption, setWordsPerCaption] = useState(3);
  const [wordGap, setWordGap] = useState(0.25);
  const [style, setStyle] = useState<SubtitleStyle>(PRESETS.viral);
  const [activeTab, setActiveTab] = useState<'style' | 'layout'>('style');

  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setVideoUrl(null);
    }
  }, [file]);

  // Generate phrase segments dynamically based on wordsPerCaption
  const dynamicPhrases = useMemo(() => {
    if (!wordLevelSubtitles.length) return [];

    const phrases: any[] = [];
    let currentWords: any[] = [];
    
    wordLevelSubtitles.forEach((word, index) => {
      currentWords.push(word);
      
      const isLastWord = index === wordLevelSubtitles.length - 1;
      const reachedCountLimit = currentWords.length >= wordsPerCaption;
      
      // Check for silence/gap (e.g., > 0.8s) to naturally break phrases
      let hugeGap = false;
      if (!isLastWord) {
        const nextWord = wordLevelSubtitles[index + 1];
        if (nextWord.start - word.end > 0.8) {
            hugeGap = true;
        }
      }

      if (reachedCountLimit || isLastWord || hugeGap) {
        const startTime = currentWords[0].start;
        const endTime = currentWords[currentWords.length - 1].end;
        const text = currentWords.map(w => w.text).join(' ');
        
        phrases.push({
          start: startTime,
          end: endTime,
          text: text,
          words: [...currentWords]
        });
        
        currentWords = [];
      }
    });
    
    return phrases;
  }, [wordLevelSubtitles, wordsPerCaption]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type === 'video/mp4') {
        setFile(selectedFile);
        setError('');
      } else {
        setError('Please select an MP4 file');
      }
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setUploading(true);
    setError('');
    setWordLevelSubtitles([]);
    setPhraseSubtitles([]);
    setSrtUrl('');

    try {
      const timestamp = Date.now();
      const storageRef = ref(storage, `videos/${timestamp}_${file.name}`);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        'state_changed',
        (snapshot) => {
          const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
          setUploadProgress(Math.round(progress));
        },
        (error) => {
          setError(`Upload failed: ${error.message}`);
          setUploading(false);
        },
        async () => {
          setUploading(false);
          setProcessing(true);

          const videoPath = `videos/${timestamp}_${file.name}`;

          try {
            const response = await fetch(
              'https://us-central1-auto-subtitle-maker.cloudfunctions.net/generate_subtitles',
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ video_path: videoPath }),
              }
            );

            const result = await response.json();

            if (result.success) {
              setWordLevelSubtitles(result.word_level_subtitles || []);
              setPhraseSubtitles(result.phrase_subtitles || []);
              setSrtUrl(result.srt_path);
              setDebugInfo(result.debug_info);
              setProcessing(false);
            } else {
              setError(`Processing failed: ${result.error}`);
              setProcessing(false);
            }
          } catch (err: any) {
            setError(`Processing failed: ${err.message}`);
            setProcessing(false);
          }
        }
      );
    } catch (err: any) {
      setError(`Error: ${err.message}`);
      setUploading(false);
    }
  };

  const renderOverlayContent = () => {
    if (!dynamicPhrases.length) return null;

    // Find the active phrase based on current time
    const activePhrase = dynamicPhrases.find(p => currentTime >= p.start && currentTime <= p.end);

    if (!activePhrase) return null;

    const containerStyle = {
      fontFamily: style.fontFamily,
      fontWeight: style.fontWeight,
      textTransform: style.textTransform,
      opacity: style.opacity,
    } as React.CSSProperties;

    const textStyle = (isActive: boolean) => ({
      color: isActive && viewMode === 'phrase' ? style.highlightColor : style.textColor,
      fontSize: `${style.fontSize}px`,
      WebkitTextStroke: style.outlineWidth > 0 ? `${style.outlineWidth}px ${style.outlineColor}` : 'none',
      textShadow: style.shadow ? '2px 2px 4px rgba(0,0,0,0.5)' : 'none',
      transform: isActive && viewMode === 'phrase' ? 'scale(1.1)' : 'scale(1)',
    } as React.CSSProperties);

    // Render differently based on mode
    if (viewMode === 'word') {
       // Stack Mode: Show only current word really big
       const currentWord = activePhrase.words.find((w: any) => currentTime >= w.start && currentTime <= w.end);
       if (!currentWord) return null;

       return (
         <div className="text-center" style={containerStyle}>
           <span className="transition-all duration-75" style={textStyle(true)}>
             {currentWord.text}
           </span>
         </div>
       );
    } else {
      // Phrase/Viral Mode
      return (
        <div className="flex flex-wrap justify-center items-end gap-y-2 max-w-4xl px-8 mx-auto leading-tight text-center" style={{...containerStyle, gap: `${wordGap}em`}}>
          {activePhrase.words.map((word: any, idx: number) => {
            const isActive = currentTime >= word.start && currentTime <= word.end;
            return (
               <span 
                 key={`${word.start}-${idx}`}
                 className="transition-all duration-100"
                 style={textStyle(isActive)}
               >
                 {word.text}
               </span>
            );
          })}
        </div>
      );
    }
  };

  const downloadJSON = () => {
    const jsonContent = JSON.stringify(wordLevelSubtitles, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-gray-900 text-white font-sans flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-gray-800 bg-gray-900/50 backdrop-blur-md flex-none z-50">
        <div className="max-w-screen-2xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center font-bold text-xl">
              A
            </div>
            <span className="font-bold text-lg tracking-tight">CaptionMaster AI</span>
          </div>
          <div className="flex items-center gap-4">
             <button className="text-sm font-medium text-gray-400 hover:text-white transition-colors">Documentation</button>
             <button className="bg-white text-gray-900 px-4 py-2 rounded-md text-sm font-bold hover:bg-gray-100 transition-colors">
               Export Video
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden relative">
        <div className="max-w-screen-2xl mx-auto px-4 py-4 h-full w-full">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
            
            {/* Left Column: Editor Preview */}
            <div className="lg:col-span-8 flex flex-col gap-4 h-full min-h-0">
              <div className="flex-1 bg-black rounded-xl overflow-hidden relative shadow-2xl border border-gray-800 group min-h-0 flex items-center justify-center">
                {videoUrl ? (
                  <div className="relative w-full h-full flex items-center justify-center bg-neutral-900">
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      className="max-h-full max-w-full w-auto h-auto object-contain"
                      controls
                      onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    />
                    
                    {/* Overlay Container */}
                    <div 
                      className="absolute inset-x-0 pointer-events-none flex justify-center w-full"
                      style={{ 
                        top: `${style.verticalPosition}%`,
                        transform: 'translateY(-50%)'
                      }}
                    >
                      {renderOverlayContent()}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-gray-500 gap-4">
                    <div className="w-16 h-16 rounded-full bg-gray-800 flex items-center justify-center">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                    </div>
                    <p className="font-medium">Upload a video to start editing</p>
                  </div>
                )}
              </div>

              {/* Timeline / Mini Status */}
              <div className="h-12 flex-none bg-gray-800/50 rounded-lg border border-gray-800 flex items-center px-4 justify-between text-xs text-gray-400">
                 <span>
                   {wordLevelSubtitles.length > 0 
                     ? `Generated ${wordLevelSubtitles.length} word timestamps`
                     : 'No subtitles generated yet'}
                 </span>
                 <span>
                   {currentTime.toFixed(2)}s
                 </span>
              </div>
            </div>

            {/* Right Column: Controls */}
            <div className="lg:col-span-4 flex flex-col gap-6 bg-gray-900/50 border-l border-gray-800 lg:pl-6 h-full min-h-0">
              <div className="flex-1 overflow-y-auto pr-2 space-y-6 custom-scrollbar">
                {/* Upload Section */}
            <div className="p-4 bg-gray-800 rounded-xl border border-gray-700">
              <label className="block w-full cursor-pointer">
                <span className="sr-only">Choose video</span>
                <input 
                  type="file" 
                  accept="video/mp4" 
                  onChange={handleFileChange}
                  disabled={uploading || processing}
                  className="block w-full text-sm text-gray-400
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-xs file:font-bold
                    file:bg-indigo-600 file:text-white
                    hover:file:bg-indigo-500
                    cursor-pointer"
                />
              </label>

              {(uploading || processing) && (
                 <div className="mt-4 space-y-2">
                   <div className="flex justify-between text-xs text-gray-400">
                     <span>{uploading ? 'Uploading...' : 'Processing AI...'}</span>
                     <span>{uploading ? `${uploadProgress}%` : ''}</span>
                   </div>
                   <div className="w-full bg-gray-700 rounded-full h-1.5">
                     <div 
                       className={`h-1.5 rounded-full transition-all duration-300 ${uploading ? 'bg-blue-500' : 'bg-indigo-500 animate-pulse'}`}
                       style={{ width: uploading ? `${uploadProgress}%` : '100%' }} 
                     />
                   </div>
                 </div>
              )}
              
              {file && !uploading && !processing && wordLevelSubtitles.length === 0 && (
                <button 
                  onClick={handleUpload}
                  className="mt-3 w-full bg-indigo-600 hover:bg-indigo-500 text-white py-2 rounded-lg text-sm font-bold transition-colors"
                >
                  Generate Captions
                </button>
              )}
              
              {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
            </div>

            {/* Editor Controls */}
            {wordLevelSubtitles.length > 0 && (
              <div className="flex-1 flex flex-col gap-6">
                
                {/* Tabs */}
                <div className="flex p-1 bg-gray-800 rounded-lg">
                  <button 
                    onClick={() => setActiveTab('style')}
                    className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${activeTab === 'style' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                  >
                    Style
                  </button>
                  <button 
                    onClick={() => setActiveTab('layout')}
                    className={`flex-1 py-1.5 text-sm font-bold rounded-md transition-all ${activeTab === 'layout' ? 'bg-gray-700 text-white shadow-sm' : 'text-gray-400 hover:text-white'}`}
                  >
                    Layout & Layout
                  </button>
                </div>

                {activeTab === 'style' ? (
                  <div className="space-y-6 animate-in slide-in-from-right-4 duration-200">
                    {/* Font Family */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Font Family</label>
                      <select 
                        value={style.fontFamily}
                        onChange={(e) => setStyle({...style, fontFamily: e.target.value})}
                        className="w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg p-2.5 focus:ring-indigo-500 focus:border-indigo-500"
                      >
                        {FONTS.map(f => (
                          <option key={f.name} value={f.value}>{f.name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Colors */}
                    <div className="grid grid-cols-2 gap-4">
                       <div className="space-y-2">
                         <label className="text-xs font-bold text-gray-500 uppercase">Text Color</label>
                         <div className="flex items-center gap-2 bg-gray-800 p-2 rounded-lg border border-gray-700">
                           <input 
                             type="color" 
                             value={style.textColor}
                             onChange={(e) => setStyle({...style, textColor: e.target.value})}
                             className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" 
                           />
                           <span className="text-xs font-mono">{style.textColor}</span>
                         </div>
                       </div>
                       <div className="space-y-2">
                         <label className="text-xs font-bold text-gray-500 uppercase">Active Color</label>
                         <div className="flex items-center gap-2 bg-gray-800 p-2 rounded-lg border border-gray-700">
                           <input 
                             type="color" 
                             value={style.highlightColor}
                             onChange={(e) => setStyle({...style, highlightColor: e.target.value})}
                             className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent" 
                           />
                           <span className="text-xs font-mono">{style.highlightColor}</span>
                         </div>
                       </div>
                    </div>

                    {/* Size & Weight */}
                    <div className="space-y-4">
                       <div className="space-y-2">
                         <div className="flex justify-between">
                           <label className="text-xs font-bold text-gray-500 uppercase">Font Size</label>
                           <span className="text-xs text-gray-400">{style.fontSize}px</span>
                         </div>
                         <input 
                           type="range" min="12" max="120" 
                           value={style.fontSize}
                           onChange={(e) => setStyle({...style, fontSize: parseInt(e.target.value)})}
                           className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                         />
                       </div>

                       <div className="space-y-2">
                          <label className="text-xs font-bold text-gray-500 uppercase">Weight</label>
                          <div className="flex gap-2">
                            {['normal', 'bold', '900'].map((w) => (
                              <button
                                key={w}
                                onClick={() => setStyle({...style, fontWeight: w})}
                                className={`flex-1 py-2 text-xs rounded border transition-colors ${
                                  style.fontWeight === w 
                                  ? 'bg-indigo-600 border-indigo-600 text-white' 
                                  : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                                }`}
                              >
                                {w === '900' ? 'Black' : w.charAt(0).toUpperCase() + w.slice(1)}
                              </button>
                            ))}
                          </div>
                       </div>
                    </div>

                    {/* Stroke / Shadow */}
                    <div className="space-y-4 border-t border-gray-800 pt-4">
                       <div className="space-y-2">
                         <div className="flex justify-between">
                           <label className="text-xs font-bold text-gray-500 uppercase">Outline Width</label>
                           <span className="text-xs text-gray-400">{style.outlineWidth}px</span>
                         </div>
                         <input 
                           type="range" min="0" max="10" 
                           value={style.outlineWidth}
                           onChange={(e) => setStyle({...style, outlineWidth: parseInt(e.target.value)})}
                           className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                         />
                       </div>
                       
                       <div className="flex items-center justify-between">
                          <label className="text-xs font-bold text-gray-500 uppercase">Drop Shadow</label>
                          <button 
                            onClick={() => setStyle({...style, shadow: !style.shadow})}
                            className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${style.shadow ? 'bg-indigo-600' : 'bg-gray-700'}`}
                          >
                            <div className={`w-4 h-4 bg-white rounded-full shadow-sm transform transition duration-200 ease-in-out ${style.shadow ? 'translate-x-6' : 'translate-x-0'}`} />
                          </button>
                       </div>

                    {/* Word Gap Control */}
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <label className="text-xs font-bold text-gray-500 uppercase">Word Gap</label>
                        <span className="text-xs text-gray-400">{wordGap.toFixed(2)}em</span>
                      </div>
                      <input 
                        type="range" min="0" max="2" step="0.05"
                        value={wordGap}
                        onChange={(e) => setWordGap(parseFloat(e.target.value))}
                        className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                      />
                      <div className="flex justify-between text-[10px] text-gray-500 px-1">
                        <span>Tight</span>
                        <span>Wide</span>
                      </div>
                    </div>
                    </div>

                  </div>
                ) : (
                  <div className="space-y-6 animate-in slide-in-from-right-4 duration-200">
                    
                    {/* View Mode */}
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-500 uppercase">Animation Style</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => setViewMode('word')}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            viewMode === 'word'
                            ? 'bg-indigo-600/20 border-indigo-600 ring-1 ring-indigo-600'
                            : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                          }`}
                        >
                          <div className="font-bold text-sm">Stack Mode</div>
                          <div className="text-xs text-gray-400 mt-1">Single word flash</div>
                        </button>
                        <button
                          onClick={() => setViewMode('phrase')}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            viewMode === 'phrase'
                            ? 'bg-indigo-600/20 border-indigo-600 ring-1 ring-indigo-600'
                            : 'bg-gray-800 border-gray-700 hover:bg-gray-700'
                          }`}
                        >
                          <div className="font-bold text-sm">Viral Mode</div>
                          <div className="text-xs text-gray-400 mt-1">Karaoke highlighting</div>
                        </button>
                      </div>
                    </div>

                    {/* Words Per Caption */}
                    <div className="space-y-2">
                       <div className="flex justify-between">
                         <label className="text-xs font-bold text-gray-500 uppercase">Words per Line</label>
                         <span className="text-xs text-gray-400">{wordsPerCaption}</span>
                       </div>
                       <input 
                         type="range" min="1" max="6" 
                         value={wordsPerCaption}
                         onChange={(e) => setWordsPerCaption(parseInt(e.target.value))}
                         className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                       />
                       <div className="flex justify-between text-[10px] text-gray-500 px-1">
                         <span>Faster</span>
                         <span>Slower</span>
                       </div>
                    </div>

                    {/* Vertical Position */}
                    <div className="space-y-2">
                       <div className="flex justify-between">
                         <label className="text-xs font-bold text-gray-500 uppercase">Vertical Position</label>
                         <span className="text-xs text-gray-400">{style.verticalPosition}%</span>
                       </div>
                       <input 
                         type="range" min="10" max="90" 
                         value={style.verticalPosition}
                         onChange={(e) => setStyle({...style, verticalPosition: parseInt(e.target.value)})}
                         className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                       />
                       <div className="flex justify-between text-[10px] text-gray-500 px-1">
                         <span>Top</span>
                         <span>Bottom</span>
                       </div>
                    </div>
                    
                    {/* Text Transform */}
                    <div className="space-y-2">
                       <label className="text-xs font-bold text-gray-500 uppercase">Casing</label>
                       <div className="flex gap-2 bg-gray-800 p-1 rounded-lg border border-gray-700">
                         {['uppercase', 'lowercase', 'capitalize'].map((t) => (
                           <button
                             key={t}
                             onClick={() => setStyle({...style, textTransform: t as any})}
                             className={`flex-1 py-1.5 text-xs rounded-md capitalize transition-colors ${
                               style.textTransform === t 
                               ? 'bg-gray-600 text-white' 
                               : 'text-gray-400 hover:text-white'
                             }`}
                           >
                             {t}
                           </button>
                         ))}
                       </div>
                    </div>

                  </div>
                )}

                <div className="pt-6 pb-4 border-t border-gray-800">
                   <button 
                     onClick={downloadJSON}
                     className="w-full flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white py-3 rounded-lg font-medium transition-colors text-sm"
                   >
                     Download JSON Project
                   </button>
                </div>
              </div>
            )}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
