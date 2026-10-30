# הודעה לטום - חיבור WhatsApp של מגה פמילי ל-API (צד Meta)

היי טום,

אנחנו מחברים את הוואטסאפ העסקי של מגה פמילי (054-227-2554) למערכת, במצב "Coexistence" - הנציגים ממשיכים לעבוד באפליקציה כרגיל, והמערכת שולחת תבניות ורואה את השיחות. הקוד אצלנו; מה שצריך מצד Meta הוא אצלך, כי הפורטפוליו העסקי שמחזיק את האפליקציה "Mega Tours Reporting" (App ID 2120853392154473) מנוהל על ידך. הכול מתוך אותה אפליקציה - לא פותחים אפליקציה חדשה.

## שלב א' - עכשיו (כ-30 דקות)

1. **אימות עסק** - business.facebook.com → Settings → Security Center → "Business verification". צריך להיות Verified. אם לא - להשלים (זה תנאי לכל השאר).

2. **מוצר WhatsApp על האפליקציה** - developers.facebook.com/apps → "Mega Tours Reporting" → Add product → **WhatsApp** → Set up. בפופאפ לבחור את הפורטפוליו של מגה (לא ליצור חדש). זה פותח WhatsApp Business Account (WABA) בפורטפוליו, עם מספר בדיקה זמני של Meta - לא נוגעים ב-054 עדיין.

3. **מוצר Facebook Login for Business** - באותו מסך Add product → **Facebook Login for Business** → Set up. אחר כך בצד שמאל: Facebook Login for Business → Settings → "Allowed Domains for the JavaScript SDK" להוסיף:
   `https://mega-events-backoffice-mega-events.vercel.app`
   ו-"Login with the JavaScript SDK" = Yes. שמור.

4. **Embedded Signup configuration** - Facebook Login for Business → Configurations → Create configuration → Login variation: **WhatsApp Embedded Signup** → בחר "WhatsApp Business App onboarding" אם מוצג (בגרסה החדשה זה ברירת מחדל) → Create. להעתיק את **Configuration ID** ולשלוח לדור.

5. **App ID + App Secret** - App settings → Basic: להעתיק **App ID** (2120853392154473) ו-**App Secret** (לחיצה על Show). את ה-Secret לשלוח לדור בערוץ מאובטח (לא בוואטסאפ/מייל פתוח - 1Password / הודעה שנמחקת).

6. **Tech Provider** - בצד שמאל WhatsApp → "Quickstart" / "Become a Tech Provider" (או App Review → Permissions and Features) → לבקש **Advanced access** ל:
   - `whatsapp_business_management`
   - `whatsapp_business_messaging`
   ה-App Review מבקש הסבר + סרטון מסך של מסך החיבור - דור ישלח לך את הסרטון והטקסט כשמסך ההגדרות יעלה (ראה שלב ב'). זה הצעד הארוך (שבוע-שבועיים אצל Meta), לכן מגישים מוקדם.

7. **מצב Live** - בראש הדשבורד של האפליקציה לוודא **App Mode: Live** (לא Development).

8. **אמצעי תשלום ל-WABA** - business.facebook.com → WhatsApp Manager → בחר את ה-WABA החדש → Settings → Payment methods → להוסיף כרטיס חברה. בלי זה הודעות תבנית לא יוצאות. (המחיר: ~$0.035 הודעה שיווקית, ~$0.005 הודעת שירות/עדכון, 1,000 הודעות שירות בחודש חינם.)

9. **טוקן קבוע** - Business Settings → Users → System users → "Insights Reader" (או system user חדש "WhatsApp Sender", סוג Admin) → Assign assets → WhatsApp accounts → ה-WABA החדש → Full control; וגם Apps → Mega Tours Reporting → Full control. אחר כך Generate new token → App: Mega Tours Reporting → Expiration: **Never** → הרשאות: `whatsapp_business_messaging` + `whatsapp_business_management` → Generate → לשלוח לדור בערוץ מאובטח.

## שלב ב' - אחרי שדור מודיע שה-webhook באוויר (5 דקות)

10. **Webhook** - developers.facebook.com → האפליקציה → WhatsApp → Configuration → Webhook → Edit:
    - Callback URL: `https://mega-events-backoffice-mega-events.vercel.app/api/whatsapp/webhook`
    - Verify token: המחרוזת שדור ישלח לך
    → Verify and save. אחר כך ב-"Webhook fields" ללחוץ Manage ולסמן Subscribe על:
    `messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`, `message_template_status_update`, `account_update`, `phone_number_quality_update`.

## שלב ג' - יום החיבור (אחרי אישור ה-App Review; אתה + אלון, 20 דקות)

הכנה יום לפני, אצל אלון:
- הטלפון עם 054-227-2554: אפליקציית **WhatsApp Business** מעודכנת (גרסה 2.24.17 ומעלה - לעדכן מהחנות).
- המספר פעיל באפליקציה לפחות 7 ימים (כן).
- **רשימות תפוצה** באפליקציה יפסיקו לעבוד (הקיימות נשארות לקריאה בלבד) - אם משתמשים, לייצא/לכתוב בצד. הדיוור יעבור למערכת.
- המחשבים של הנציגים יתנתקו ויתחברו מחדש; **WhatsApp for Windows לא נתמך** - עוברים ל-web.whatsapp.com בדפדפן. הטלפון עצמו ממשיך רגיל.

החיבור עצמו:
11. אתה מחובר לפייסבוק כמנהל של הפורטפוליו של מגה, פותח בבקאופיס: הגדרות → WhatsApp → "חבר את WhatsApp של החברה".
12. בפופאפ של Meta: לבחור את הפורטפוליו של מגה ואת ה-WABA הקיים (לא ליצור חדש) → האפשרות "connect an existing WhatsApp Business app number" → להזין 054-227-2554 → קוד אימות מגיע לאפליקציה בטלפון של אלון → לאשר **שיתוף היסטוריית צ'אטים ואנשי קשר** (6 חודשים אחורה; בחירה סופית, אי אפשר לשנות אחר כך) → Finish.
13. זהו. המערכת מבקשת את סנכרון ההיסטוריה לבד (חייב לקרות בתוך 24 שעות - אוטומטי). דור מעדכן בוורסל את ה-Phone number ID שהתקבל.

## שלב ד' - תבניות (בהמשך, 10 דקות)

14. WhatsApp Manager → Message templates → Create template, שפה עברית, קטגוריה לפי הטבלה. אלון כותב את הנוסחים, דור ישלח את הרשימה המדויקת (שמות קבועים: `booking_link`, `offer_sent`, `payment_received`, `trip_details`, `tour_live`, `newsletter`). אישור של Meta לוקח דקות עד יום.

15. **`waitlist_date_open`** - התבנית של "נפתח תאריך" (30.10). עברית, שלושה משתנים, קטגוריה Marketing (Meta עשוי לסווג אותה כך בכל מקרה):
    > היי {{1}}, מה שחיכיתם לו עלה!
    > נפתח תאריך ל{{2}}.
    > אפשר להציץ כאן: {{3}}
    > נציג שלנו יחזור אליכם בקרוב.

    דוגמאות למשתנים לטופס של Meta: `דנה`, `טיול ברלין`, `https://mega-family.vercel.app/package/berlin/`. ברגע שהיא מאושרת והמספר מחובר, ההודעה יוצאת לבד - אין מה להפעיל. אחרי האישור ללחוץ "סנכרן תבניות" בבקאופיס (הגדרות → WhatsApp), למקרה שהעדכון מ-Meta לא הגיע.

## מה דור שולח לך
- מחרוזת Verify token (שלב ב').
- סרטון + טקסט ל-App Review (שלב א' 6).
- רשימת התבניות (שלב ד').

## מה אתה שולח לדור (בערוץ מאובטח)
- Configuration ID (4), App Secret (5), הטוקן הקבוע (9), ואישור שה-App Review הוגש / אושר.

תודה!
