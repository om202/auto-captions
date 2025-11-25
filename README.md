# Auto Captions - Monorepo

A monorepo for auto-caption generation with Firebase backend and Next.js frontend.

## Project Structure

```
auto-captions/
├── frontend/              # Next.js application
│   ├── app/              # App router pages
│   ├── public/           # Static assets
│   └── package.json
├── functions/            # Firebase Cloud Functions (Python)
│   ├── main.py          # Cloud Functions
│   ├── requirements.txt # Python dependencies
│   └── package.json
├── package.json          # Root workspace configuration
├── firebase.json         # Firebase configuration
├── .firebaserc          # Firebase project settings
└── README.md            # This file
```

## Setup

### 1. Install Dependencies

Install all workspace dependencies:

```bash
npm install
```

### 2. Install Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 3. Install Python Dependencies for Cloud Functions

```bash
cd functions
pip install -r requirements.txt
cd ..
```

### 4. Get Firebase Service Account Key (Optional - for Admin SDK)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `auto-subtitle-maker`
3. Go to Project Settings > Service Accounts
4. Click "Generate New Private Key"
5. Save as `firebase-service-account.json` in the project root

## Development

### Run Frontend

```bash
npm run dev:frontend
```

Opens at `http://localhost:3000`

### Run Cloud Functions Locally

```bash
npm run dev:functions
```

### Run Both (in separate terminals)

Terminal 1:
```bash
npm run dev:frontend
```

Terminal 2:
```bash
npm run dev:functions
```

## Deployment

### Deploy Cloud Functions

```bash
npm run deploy:functions
```

### Deploy Frontend (Firebase Hosting)

```bash
npm run build:frontend
npm run deploy:hosting
```

### Deploy Everything

```bash
npm run deploy
```

## Firebase Configuration

- **Project ID**: auto-subtitle-maker
- **Storage Bucket**: gs://auto-subtitle-maker.firebasestorage.app
- **Functions Region**: us-central1

## Cloud Functions

### process_video
- **Method**: POST
- **URL**: https://us-central1-auto-subtitle-maker.cloudfunctions.net/process_video
- **Body**: `{"video_url": "https://example.com/video.mp4"}`

## Frontend

Next.js app with:
- TypeScript
- Tailwind CSS
- App Router
- Firebase SDK integration

## Workspaces

This monorepo uses npm workspaces to manage dependencies across packages:

- `frontend` - Next.js application
- `functions` - Firebase Cloud Functions

All dependencies can be installed from the root with `npm install`.
