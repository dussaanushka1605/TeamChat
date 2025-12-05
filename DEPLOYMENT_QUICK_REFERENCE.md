# Quick Deployment Reference

## ✅ Backend (Render) - DEPLOYED
**URL:** `https://teamchat-1-llwr.onrender.com`

**Environment Variables Set:**
- ✅ `MONGO_URI` - Your MongoDB connection string
- ✅ `JWT_SECRET` - Your secret key
- ⚠️ `FRONTEND_URL` - **UPDATE THIS** after Netlify deployment with your Netlify URL
- ✅ `PORT` - Auto-provided by Render

---

## 🚀 Frontend (Netlify) - TO DEPLOY

### Required Environment Variable:
```
NEXT_PUBLIC_API_URL=https://teamchat-1-llwr.onrender.com
```

### Netlify Settings:
- **Base directory:** `frontend`
- **Build command:** `npm run build`
- **Publish directory:** `frontend/.next`

### Steps:
1. Go to [Netlify](https://app.netlify.com/)
2. Import from GitHub → Select your repo
3. Set base directory: `frontend`
4. Add environment variable: `NEXT_PUBLIC_API_URL` = `https://teamchat-1-llwr.onrender.com`
5. Deploy!

---

## ⚠️ After Netlify Deployment:

1. Copy your Netlify URL (e.g., `https://your-app-123.netlify.app`)
2. Go to Render dashboard → Your backend service → Environment
3. Update `FRONTEND_URL` = `https://your-app-123.netlify.app`
4. Save (auto-redeploys)

---

## 🧪 Test URLs:

- **Backend Health:** https://teamchat-1-llwr.onrender.com/health
- **Frontend:** Your Netlify URL (after deployment)

---

## 📝 Notes:

- Backend CORS is configured to allow your Netlify domain (after you update FRONTEND_URL)
- Socket.io will work automatically once both are deployed
- Make sure MongoDB Atlas allows connections from Render IPs

