from firebase_functions import https_fn, options
from firebase_admin import initialize_app, firestore, storage
import google.cloud.firestore
from google.cloud import speech
import tempfile
import os
import json
import subprocess

# Initialize Firebase Admin
initialize_app()

@https_fn.on_request(
    cors=options.CorsOptions(
        cors_origins="*",
        cors_methods=["post"],
    )
)
def generate_subtitles(req: https_fn.Request) -> https_fn.Response:
    """Generate subtitles from uploaded video"""
    try:
        data = req.get_json()
        
        if not data or 'video_path' not in data:
            return https_fn.Response(
                response=json.dumps({"success": False, "error": "video_path required"}),
                status=400,
                headers={"Content-Type": "application/json"}
            )
        
        video_path = data['video_path']
        
        # Create processing job in Firestore
        db = firestore.client()
        job_ref = db.collection('subtitle_jobs').document()
        job_ref.set({
            'video_path': video_path,
            'status': 'processing',
            'created_at': firestore.SERVER_TIMESTAMP
        })
        
        # Get video from storage
        bucket = storage.bucket()
        blob = bucket.blob(video_path)
        
        # Download video to temp file
        with tempfile.NamedTemporaryFile(suffix='.mp4', delete=False) as video_file:
            blob.download_to_filename(video_file.name)
            video_temp_path = video_file.name
        
        try:
            # Extract audio and convert to mono using ffmpeg
            audio_temp_path = video_temp_path.replace('.mp4', '.wav')
            
            # ffmpeg command to extract audio as mono, 16kHz, 16-bit PCM WAV
            subprocess.run([
                'ffmpeg', '-i', video_temp_path,
                '-vn',  # No video
                '-acodec', 'pcm_s16le',  # 16-bit PCM
                '-ar', '16000',  # 16kHz sample rate
                '-ac', '1',  # Mono (1 channel)
                audio_temp_path
            ], check=True, capture_output=True)
            
            # Read audio content
            with open(audio_temp_path, 'rb') as audio_file:
                audio_content = audio_file.read()
            
            # Check audio file size
            audio_size_mb = len(audio_content) / (1024 * 1024)
            print(f"Audio file size: {audio_size_mb:.2f} MB")
            
            # Transcribe using Google Speech-to-Text
            speech_client = speech.SpeechClient()
            
            # For audio longer than 1 minute or larger than 10MB, use long_running_recognize
            # Otherwise use synchronous recognize
            use_long_running = audio_size_mb > 10
            
            config = speech.RecognitionConfig(
                encoding=speech.RecognitionConfig.AudioEncoding.LINEAR16,
                sample_rate_hertz=16000,
                language_code="en-US",
                enable_word_time_offsets=True,  # Critical for word-level timestamps
                audio_channel_count=1,
                # Note: Not using model parameter as it might interfere with word timestamps
            )
            
            if use_long_running:
                # Upload audio to Cloud Storage for long-running recognition
                audio_blob = bucket.blob(f"temp_audio/{video_path.replace('videos/', '')}.wav")
                audio_blob.upload_from_filename(audio_temp_path)
                
                audio_data = speech.RecognitionAudio(uri=f"gs://{bucket.name}/{audio_blob.name}")
                operation = speech_client.long_running_recognize(config=config, audio=audio_data)
                
                print("Waiting for long-running transcription to complete...")
                response = operation.result(timeout=300)  # 5 minute timeout
                
                # Clean up temp audio from storage
                audio_blob.delete()
            else:
                # Synchronous recognition for short audio
                audio_data = speech.RecognitionAudio(content=audio_content)
                response = speech_client.recognize(config=config, audio=audio_data)
            
            print(f"Transcription completed. Results count: {len(response.results)}")
            
            # Check if we got any results
            if not response.results:
                raise Exception("No transcription results returned from Speech-to-Text API. The audio might be silent or too quiet.")
            
            # Generate word-level timestamped subtitles for precise timing
            word_level_subtitles = []
            subtitle_index = 1
            
            # Collect all words with precise timestamps from all results
            for idx, result in enumerate(response.results):
                alternative = result.alternatives[0]
                transcript_preview = alternative.transcript[:100] if len(alternative.transcript) > 100 else alternative.transcript
                print(f"Result {idx + 1} transcript: {transcript_preview}")
                
                # Check if words attribute exists and has content
                has_words = hasattr(alternative, 'words') and alternative.words is not None and len(alternative.words) > 0
                print(f"Result {idx + 1} words available: {len(alternative.words) if has_words else 0}")
                
                if has_words:
                    print(f"Result {idx + 1} first word: {alternative.words[0].word}, start: {alternative.words[0].start_time.total_seconds()}")
                    for word in alternative.words:
                        word_level_subtitles.append({
                            'index': subtitle_index,
                            'start': word.start_time.total_seconds(),
                            'end': word.end_time.total_seconds(),
                            'text': word.word
                        })
                        subtitle_index += 1
                else:
                    print(f"WARNING: Result {idx + 1} has NO word-level timestamps! Transcript: {alternative.transcript[:50]}")
            
            print(f"Total word-level subtitles collected: {len(word_level_subtitles)}")
            
            if len(word_level_subtitles) == 0:
                print("ERROR: No word-level timestamps were collected from any results!")
                print("This might indicate:")
                print("- Audio quality issues")
                print("- Speech-to-Text API configuration issue")
                print("- API version compatibility issue")
            print(f"Total word-level subtitles collected: {len(word_level_subtitles)}")
            
            # Also create phrase-level subtitles for traditional SRT format
            # (Grouping words into readable phrases)
            phrase_subtitles = []
            phrase_index = 1
            
            # Basic default grouping for SRT backward compatibility
            if word_level_subtitles:
                current_phrase_words = []
                current_phrase_start = None
                
                # Default to standard SRT length (8-10 words) for file download
                # Frontend now handles visual display grouping dynamically
                MAX_WORDS_FOR_SRT = 10
                
                for i, word_data in enumerate(word_level_subtitles):
                    if current_phrase_start is None:
                        current_phrase_start = word_data['start']
                    
                    current_phrase_words.append(word_data)
                    
                    # Simple grouping for SRT file
                    should_break = False
                    
                    if len(current_phrase_words) >= MAX_WORDS_FOR_SRT:
                        should_break = True
                    elif i < len(word_level_subtitles) - 1:
                        # Break on long pauses
                        if word_level_subtitles[i+1]['start'] - word_data['end'] > 1.0:
                             should_break = True
                    
                    if should_break or i == len(word_level_subtitles) - 1:
                        phrase_text = ' '.join([w['text'] for w in current_phrase_words])
                        phrase_end = current_phrase_words[-1]['end']
                        
                        phrase_subtitles.append({
                            'index': phrase_index,
                            'start': current_phrase_start,
                            'end': phrase_end,
                            'text': phrase_text
                        })
                        
                        phrase_index += 1
                        current_phrase_words = []
                        current_phrase_start = None
            else:
                # Fallback: No word-level timestamps available, use transcript-level
                print("WARNING: Creating fallback subtitles without word-level timestamps")
                for result in response.results:
                    alternative = result.alternatives[0]
                    if alternative.transcript:
                        phrase_subtitles.append({
                            'index': phrase_index,
                            'start': 0.0,  # No timing available
                            'end': 0.0,
                            'text': alternative.transcript
                        })
                        phrase_index += 1
            
            print(f"Total phrase-level subtitles created: {len(phrase_subtitles)}")
            
            # Generate SRT content from phrase-level subtitles
            srt_content = generate_srt(phrase_subtitles)
            
            # Update job status
            job_ref.update({
                'status': 'completed',
                'word_level_subtitles': word_level_subtitles,
                'phrase_subtitles': phrase_subtitles,
                'srt_content': srt_content,
                'completed_at': firestore.SERVER_TIMESTAMP
            })
            
            return https_fn.Response(
                response=json.dumps({
                    "success": True,
                    "job_id": job_ref.id,
                    "word_level_subtitles": word_level_subtitles,
                    # We still return phrase_subtitles for legacy/SRT purposes but frontend will ignore for display
                    "phrase_subtitles": phrase_subtitles,
                    "srt": srt_content,
                    "debug_info": {
                        "total_results": len(response.results),
                        "word_count": len(word_level_subtitles),
                        "phrase_count": len(phrase_subtitles),
                        "has_word_timestamps": len(word_level_subtitles) > 0
                    }
                }),
                status=200,
                headers={"Content-Type": "application/json"}
            )
            
        finally:
            # Cleanup temp files
            if os.path.exists(video_temp_path):
                os.unlink(video_temp_path)
            if 'audio_temp_path' in locals() and os.path.exists(audio_temp_path):
                os.unlink(audio_temp_path)
        
    except Exception as e:
        # Update job with error if job_ref exists
        if 'job_ref' in locals():
            try:
                job_ref.update({
                    'status': 'failed',
                    'error': str(e),
                    'completed_at': firestore.SERVER_TIMESTAMP
                })
            except:
                pass
        
        return https_fn.Response(
            response=json.dumps({"success": False, "error": str(e)}),
            status=500,
            headers={"Content-Type": "application/json"}
        )


def generate_srt(subtitles):
    """Convert subtitle data to SRT format"""
    srt_content = ""
    
    for sub in subtitles:
        start_time = format_time(sub['start'])
        end_time = format_time(sub['end'])
        
        srt_content += f"{sub['index']}\n"
        srt_content += f"{start_time} --> {end_time}\n"
        srt_content += f"{sub['text']}\n\n"
    
    return srt_content


def format_time(seconds):
    """Format seconds to SRT time format (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"
