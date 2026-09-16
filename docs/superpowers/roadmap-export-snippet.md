# ייצוא הרודמפ מהדפדפן

לפתוח את אפליקציית הרודמפ, F12 → Console, להדביק ולשמור את הפלט כ-`roadmap.json`:

```js
copy(JSON.stringify({
  tasks: JSON.parse(localStorage.getItem('me_tasks') || '{"tasks":[]}').tasks || [],
  mkt: JSON.parse(localStorage.getItem('me_mkt') || '{"tasks":[]}').tasks || [],
}, null, 2))
```

אם מפתח ה-localStorage של השיווק שונה — `Object.keys(localStorage)` ולעדכן את השם בפקודה.

## הרצת הייבוא

```
npx tsx scripts/import-roadmap.ts roadmap.json --people dor=a@x.com,alon=b@y.com,tom=c@z.com --dry-run
```

ברירת המחדל היא **create-only**: משימות שכבר יובאו ונערכו ב-`/tasks` (סטטוס, אחראי וכו') לא
נדרסות אף פעם — הן מדווחות כ-`existing (left as is)`. משימה שנמחקה ב-`/tasks` מדווחת כ-
`skipped (deleted in /tasks)` ולעולם לא תיווצר מחדש. כדי לדרוס שדות של משימות קיימות (חיות,
לא מחוקות) בכוונה, להוסיף `--update-existing` — ואז ה-dry-run מסמן `⚠ edited in /tasks since
import` על כל שורה שה-DB שלה נערך אחרי שנוצרה, כדי לדעת בדיוק מה עומד להידרס לפני שמריצים
בפועל (בלי הדגל, לעולם אין כתיבה למשימות קיימות).
