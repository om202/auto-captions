'use client';

import { useState } from 'react';
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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [subtitles, setSubtitles] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [srtUrl, setSrtUrl] = useState('');

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
    setSubtitles([]);
    setSrtUrl('');

    try {
      // Upload to Firebase Storage
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
          // Upload completed
          setUploading(false);
          setProcessing(true);

          // Get the storage path
          const videoPath = `videos/${timestamp}_${file.name}`;

          // Call Cloud Function to generate subtitles
          try {
            const response = await fetch(
              'https://us-central1-auto-subtitle-maker.cloudfunctions.net/generate_subtitles',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ video_path: videoPath }),
              }
            );

            const result = await response.json();

            if (result.success) {
              setSubtitles(result.subtitles);
              setSrtUrl(result.srt_path);
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

  const downloadSRT = () => {
    if (!srtUrl) return;
    
    const srtContent = generateSRT(subtitles);
    const blob = new Blob([srtContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'subtitles.srt';
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateSRT = (subs: any[]) => {
    return subs.map(sub => {
      const start = formatTime(sub.start);
      const end = formatTime(sub.end);
      return `${sub.index}\n${start} --> ${end}\n${sub.text}\n`;
    }).join('\n');
  };

  const formatTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.floor((seconds % 1) * 1000);
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)},${pad(millis, 3)}`;
  };

  const pad = (num: number, size: number = 2) => {
    return num.toString().padStart(size, '0');
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            Auto Captions
          </h1>
          <p className="text-gray-600 mb-8">
            Upload an MP4 video and get automatic subtitles
          </p>

          <div className="space-y-6">
            {/* File Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Video (MP4)
              </label>
              <input
                type="file"
                accept="video/mp4"
                onChange={handleFileChange}
                disabled={uploading || processing}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-indigo-50 file:text-indigo-600
                  hover:file:bg-indigo-100
                  disabled:opacity-50"
              />
            </div>

            {/* Upload Button */}
            {file && !uploading && !processing && (
              <button
                onClick={handleUpload}
                className="w-full bg-indigo-600 text-white py-3 px-4 rounded-md
                  hover:bg-indigo-700 transition-colors font-medium"
              >
                Upload and Generate Subtitles
              </button>
            )}

            {/* Upload Progress */}
            {uploading && (
              <div className="space-y-2">
                <div className="flex justify-between text-sm text-gray-600">
                  <span>Uploading...</span>
                  <span>{uploadProgress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-indigo-600 h-2 rounded-full transition-all"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            )}

            {/* Processing Status */}
            {processing && (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                <p className="mt-4 text-gray-600">
                  Processing video and generating subtitles...
                </p>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md">
                {error}
              </div>
            )}

            {/* Results */}
            {subtitles.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold text-gray-900">
                    Generated Subtitles
                  </h2>
                  <button
                    onClick={downloadSRT}
                    className="bg-green-600 text-white py-2 px-4 rounded-md
                      hover:bg-green-700 transition-colors font-medium"
                  >
                    Download SRT
                  </button>
                </div>

                <div className="bg-gray-50 rounded-md p-4 max-h-96 overflow-y-auto">
                  {subtitles.map((sub) => (
                    <div key={sub.index} className="mb-4 pb-4 border-b border-gray-200 last:border-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-gray-500">
                          #{sub.index}
                        </span>
                        <span className="text-xs text-gray-500">
                          {formatTime(sub.start)} → {formatTime(sub.end)}
                        </span>
                      </div>
                      <p className="text-gray-900">{sub.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
