# מדריך קצר: דומיין שולח למגה פמילי ב-ZeptoMail (22.10.2026)

**מטרה:** שאישור הזמנה / קבלה / חומר לטיול ייצאו מכתובת `@megafamily.co.il`, לא מ-`alon@mega-events.co.il`.

**מצב היום:** הבק-אופיס שולח דרך ZeptoMail (`smtp.zeptomail.com`, `lib/email.ts`) עם **Mail Agent אחד** -
פרטי ה-SMTP שלו הם `NEXT_SECRET_EMAIL_SERVER_USER` / `_PASSWORD` ב-Vercel. Mail Agent אחד יכול לאמת
**כמה דומיינים**: אותם פרטי SMTP, רק כתובת ה-From משתנה. זה המסלול הקצר - בלי סוד חדש ב-Vercel.

**זמן:** ~15 דקות עבודה + המתנה ל-DNS (דקות עד שעה-שעתיים).

## הצעדים

1. **ZeptoMail** - https://mailagent.zoho.com (חשבון Zoho של מגה אירועים) ← **Mail Agents** ← ה-Mail Agent הקיים
   (זה שמאומת עליו `mega-events.co.il`).
2. **Domains** ← **Add Domain** ← `megafamily.co.il` (בלי `www`).
3. ZeptoMail מציג **רשומות DNS**. להעתיק אותן כמו שהן אצל מי שמנהל את ה-DNS של `megafamily.co.il`
   (הרשם / Cloudflare / Vercel - איפה שהרשומות של האתר יושבות):
   - **DKIM** - רשומת TXT (שם כמו `zmail._domainkey`, ערך ארוך שמתחיל `v=DKIM1`). להדביק כערך אחד - יש רשמים
     שמפצלים ערך ארוך לשניים לבד; לא לפצל ידנית.
   - **Bounce** - רשומת CNAME (השם והערך כפי שמוצגים).
   - **SPF** - רשומת TXT על השורש: `v=spf1 include:zeptomail.net ~all`.
     **אם כבר יש SPF לדומיין** (למשל של Google Workspace: `v=spf1 include:_spf.google.com ~all`) - מוסיפים
     `include:zeptomail.net` **לתוך** הרשומה הקיימת. דומיין עם שתי רשומות SPF = כל המיילים שלו נכשלים.
   - ב-Cloudflare: הרשומות האלה "DNS only" (ענן אפור), לא Proxied.
4. חזרה ל-ZeptoMail ← **Verify**. ירוק = ה-DNS גמור. אדום = להמתין (עד שעה-שעתיים) ולנסות שוב.
5. **כתובת השולח** - להחליט, למשל `office@megafamily.co.il`. לשליחה היא לא חייבת להיות תיבה קיימת, אבל לקוחות
   עונים על אישורים - כדאי שתהיה תיבה (או alias) ב-Google Workspace של פמילי שמישהו קורא.
6. **Vercel - כלום.** אותו Mail Agent = אותם `NEXT_SECRET_EMAIL_SERVER_USER` / `_PASSWORD`.
   (Mail Agent נפרד לפמילי = עוד זוג סודות, אותה תוצאה - לא צריך.)
7. **תגיד לי** "הדומיין מאומת" + הכתובת שבחרת.

## מה קורה אחר כך (לא עליך)

הסבב הבא בקוד: `from` לפי חברה (מגה פמילי ← `office@megafamily.co.il`), **CC לנציג המשויך** על אישור הזמנה /
קבלה / חומר לטיול, תבנית לכל שליחה, כפתור בעמוד הקארד ורישום "נשלח" על ההזמנה. הצעה ותכתובת שירות נשארות
מהמייל של הנציג עצמו (הכלל שלך מ-21.10).

## אם משהו נתקע

- **DKIM לא מאומת:** הערך הודבק עם מרכאות / רווחים / פוצל. להעתיק שוב מ-ZeptoMail, ערך אחד.
- **SPF "too many DNS lookups":** מותר עד 10 `include` ברשומה; להסיר includes ישנים שאינם בשימוש.
- **Verify ירוק אבל מייל נופל לספאם:** זה DMARC - לא חובה לשלב הזה; אם כבר יש `_dmarc` לדומיין, לוודא שהוא
  `p=none` או שה-DKIM מיושר (From = הדומיין המאומת).
