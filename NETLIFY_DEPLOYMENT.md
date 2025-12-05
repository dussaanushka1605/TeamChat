# Netlify Frontend Deployment Guide

## Your Backend URL
**Backend (Render):** `https://teamchat-1-llwr.onrender.com`

## Step-by-Step Netlify Deployment

### Step 1: Push Code to GitHub
Make sure your latest code is pushed to GitHub.

### Step 2: Create Netlify Site
1. Go to [Netlify Dashboard](https://app.netlify.com/)
2. Click **"Add new site"** → **"Import an existing project"**
3. Connect to GitHub and select your `TeamChat` repository

### Step 3: Configure Build Settings

**Build Settings:**
- **Base directory:** `frontend`
- **Build command:** `npm run build`
- **Publish directory:** `frontend/.next`
- **Node version:** `18` (or latest LTS)

### Step 4: Set Environment Variable

**CRITICAL:** Add this environment variable in Netlify:

1. Go to **Site settings** → **Environment variables**
2. Click **"Add a variable"**
3. Add:
   - **Key:** `NEXT_PUBLIC_API_URL`
   - **Value:** `https://teamchat-1-llwr.onrender.com`
4. Click **"Save"**

### Step 5: Deploy
1. Click **"Deploy site"**
2. Wait for build to complete (usually 2-3 minutes)
3. Your site will be live at: `https://random-name-123.netlify.app`

### Step 6: Update Backend CORS (Important!)

After you get your Netlify URL, update Render backend:

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your backend service
3. Go to **Environment** tab
4. Update `FRONTEND_URL` to your Netlify URL (e.g., `https://your-app-name.netlify.app`)
5. Save changes (Render will auto-redeploy)

---

## Environment Variable Summary

### Frontend (Netlify) - Required:
```
NEXT_PUBLIC_API_URL=https://teamchat-1-llwr.onrender.com
```

### Backend (Render) - Update after Netlify deploy:
```
FRONTEND_URL=https://your-netlify-app-name.netlify.app
```

---

## Testing After Deployment

1. Visit your Netlify URL
2. Try signing up/logging in
3. Create a channel
4. Send messages
5. Check browser console (F12) for any errors

---

## Troubleshooting

**"Failed to fetch" errors:**
- Verify `NEXT_PUBLIC_API_URL` is set correctly in Netlify
- Check backend URL is accessible: https://teamchat-1-llwr.onrender.com/health
- Ensure backend `FRONTEND_URL` includes your Netlify domain

**CORS errors:**
- Make sure backend `FRONTEND_URL` matches your Netlify URL exactly
- No trailing slash in URLs

**Build fails:**
- Check Node version is 18+
- Verify all dependencies are in package.json
- Check build logs in Netlify dashboard

