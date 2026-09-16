# ייצוא הרודמפ מהדפדפן

לפתוח את אפליקציית הרודמפ, F12 → Console, להדביק ולשמור את הפלט כ-`roadmap.json`:

```js
copy(JSON.stringify({
  tasks: JSON.parse(localStorage.getItem('me_tasks') || '{"tasks":[]}').tasks || [],
  mkt: JSON.parse(localStorage.getItem('me_mkt') || '{"tasks":[]}').tasks || [],
}, null, 2))
```

אם מפתח ה-localStorage של השיווק שונה — `Object.keys(localStorage)` ולעדכן את השם בפקודה.
