/* ==========================================================================
   LIAD — חשבונית PDF

   מייצר קובץ PDF אמיתי בדפדפן, בלי שרת ובלי ספריות חיצוניות.

   למה לא "הדפסה ← שמירה כ-PDF": כי אז אי אפשר *לשלוח* את הקובץ. הדרישה
   היא שהלקוחה תקבל חשבונית כקובץ מצורף, לא כהודעת טקסט, ולשם כך צריך
   קובץ שאפשר להחזיק ביד — Blob.

   איך זה עובד:
     1. החשבונית מצוירת על canvas ידנית (Canvas 2D תומך ב-RTL מלא,
        כולל עברית — בניגוד לכתיבת טקסט ישירות ל-PDF, שהייתה דורשת
        הטמעת גופן עברי שלם בקובץ).
     2. ה-canvas נדחס ל-JPEG ונעטף במבנה PDF מינימלי שנכתב כאן בייט־בייט.
     3. הקובץ נשלח: קודם מנסים Web Share API עם הקובץ עצמו — כך בנייד
        וואטסאפ ומייל מקבלים PDF מצורף אמיתי. אם אין תמיכה, הקובץ יורד
        והאפליקציה נפתחת עם ההודעה מוכנה.

   שליחה אוטומטית לגמרי (בלי שהלקוחה תלחץ "שלח") דורשת שרת — ראו
   INVOICE_ENDPOINT למטה.
   ========================================================================== */

import { money, CONFIG } from "./store.js";

/**
 * שרת שמקבל את החשבונית ושולח אותה בעצמו במייל / WhatsApp Business API.
 * כל עוד הערך null — השליחה עוברת דרך המכשיר של הלקוחה.
 */
export const INVOICE_ENDPOINT = null;

/* מידות הדף: A4 ב-150dpi, כדי שהטקסט יישאר חד גם בהדפסה */
const PAGE = { w: 1240, h: 1754, pad: 96 };

const BRAND = {
  gold: "#c9a227",
  goldSoft: "#e3caa0",
  ink: "#2b2724",
  muted: "#8b8178",
  line: "#e6ded4",
  cream: "#fbf8f4",
};

const STUDIO = {
  name: "LIAD — אסתטיקה ויופי",
  email: "rubinliad@gmail.com",
  address: "מתחם הפיל, בנימינה",
};


/* ==========================================================================
   ציור החשבונית
   ========================================================================== */

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // בלי לוגו עדיף מאשר בלי חשבונית
    img.src = src;
  });
}

/**
 * מצייר את החשבונית ומחזיר את ה-canvas.
 * @param {Object} order ההזמנה כפי שנשמרה ב-store
 */
export async function drawInvoice(order) {
  const canvas = document.createElement("canvas");
  canvas.width = PAGE.w;
  canvas.height = PAGE.h;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  ctx.direction = "rtl";
  ctx.textBaseline = "alphabetic";

  const right = PAGE.w - PAGE.pad;   // בעברית מתחילים מימין
  const left = PAGE.pad;
  let y = PAGE.pad;

  /* ---- כותרת ממותגת ---- */

  // פס זהב עליון — החתימה הוויזואלית של המותג
  const stripe = ctx.createLinearGradient(0, 0, PAGE.w, 0);
  stripe.addColorStop(0, BRAND.gold);
  stripe.addColorStop(1, BRAND.goldSoft);
  ctx.fillStyle = stripe;
  ctx.fillRect(0, 0, PAGE.w, 14);

  const logo = await loadImage("assets/liad-logo.png");
  if (logo) {
    const h = 110;
    const w = (logo.width / logo.height) * h;
    ctx.drawImage(logo, right - w, y + 6, w, h);
  } else {
    ctx.fillStyle = BRAND.ink;
    ctx.font = "700 46px Fraunces, Georgia, serif";
    ctx.textAlign = "right";
    ctx.fillText("LIAD", right, y + 60);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = BRAND.muted;
  ctx.font = "500 22px Assistant, Arial, sans-serif";
  ctx.fillText("חשבונית", left, y + 34);

  ctx.fillStyle = BRAND.ink;
  ctx.font = "700 34px Assistant, Arial, sans-serif";
  ctx.fillText(order.id, left, y + 76);

  y += 132;
  line(ctx, left, right, y);
  y += 46;

  /* ---- פרטי ההזמנה ---- */

  const created = new Date(order.createdAt).toLocaleString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });

  const address = order.shipping.method === "delivery"
    ? [order.shipping.address.street,
       order.shipping.address.apartment && `דירה ${order.shipping.address.apartment}`,
       order.shipping.address.city,
       order.shipping.address.zip].filter(Boolean).join(", ")
    : `איסוף עצמי — ${order.shipping.address.pickup}`;

  const rows = [
    ["תאריך", created],
    ["לקוחה", `${order.customer.firstName} ${order.customer.lastName}`],
    ["טלפון", order.customer.phone],
    ["אימייל", order.customer.email],
    [order.shipping.method === "delivery" ? "כתובת למשלוח" : "איסוף", address],
  ];
  if (order.notes) rows.push(["הערות", order.notes]);

  rows.forEach(([label, value]) => {
    ctx.textAlign = "right";
    ctx.fillStyle = BRAND.muted;
    ctx.font = "400 24px Assistant, Arial, sans-serif";
    ctx.fillText(label, right, y);

    ctx.textAlign = "left";
    ctx.fillStyle = BRAND.ink;
    ctx.font = "500 24px Assistant, Arial, sans-serif";
    ctx.fillText(clip(ctx, value, PAGE.w - PAGE.pad * 2 - 220), left, y);
    y += 42;
  });

  y += 22;

  /* ---- טבלת הפריטים ---- */

  const colQty = PAGE.w / 2 + 60;
  const colSum = left;

  ctx.fillStyle = BRAND.muted;
  ctx.font = "400 20px Assistant, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("מוצר", right, y);
  ctx.textAlign = "center";
  ctx.fillText("כמות", colQty, y);
  ctx.textAlign = "left";
  ctx.fillText("סכום", colSum, y);

  y += 16;
  line(ctx, left, right, y);
  y += 42;

  order.items.forEach((item) => {
    ctx.fillStyle = BRAND.ink;
    ctx.font = "400 24px Assistant, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(clip(ctx, item.title, right - colQty - 60), right, y);

    ctx.textAlign = "center";
    ctx.fillText(String(item.qty), colQty, y);

    ctx.textAlign = "left";
    ctx.fillText(money(item.lineTotal), colSum, y);

    y += 20;
    line(ctx, left, right, y, BRAND.line, 1);
    y += 34;
  });

  /* ---- סיכום ---- */

  y += 18;
  const total = [
    ["סכום ביניים", money(order.totals.subtotal)],
    ...(order.totals.discount > 0
      ? [[`הנחה (${order.totals.coupon ?? ""})`, `−${money(order.totals.discount)}`]]
      : []),
    ["משלוח", order.totals.shipping === 0 ? "חינם" : money(order.totals.shipping)],
  ];

  total.forEach(([label, value]) => {
    ctx.fillStyle = BRAND.muted;
    ctx.font = "400 24px Assistant, Arial, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(label, right, y);
    ctx.fillStyle = BRAND.ink;
    ctx.textAlign = "left";
    ctx.fillText(value, colSum, y);
    y += 40;
  });

  y += 10;
  line(ctx, left, right, y, BRAND.gold, 2);
  y += 52;

  ctx.fillStyle = BRAND.ink;
  ctx.font = "700 34px Assistant, Arial, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("סה״כ לתשלום", right, y);
  ctx.textAlign = "left";
  ctx.fillText(money(order.totals.total), colSum, y);

  /* ---- כותרת תחתונה ---- */

  const footY = PAGE.h - PAGE.pad;
  line(ctx, left, right, footY - 62, BRAND.line, 1);

  ctx.fillStyle = BRAND.muted;
  ctx.font = "400 21px Assistant, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${STUDIO.name} · ${STUDIO.email} · ${STUDIO.address}`, PAGE.w / 2, footY - 24);

  if (order.payment?.status !== "paid") {
    ctx.fillStyle = BRAND.muted;
    ctx.font = "400 19px Assistant, Arial, sans-serif";
    ctx.fillText("מסמך זה הוא סיכום הזמנה. חשבונית מס תישלח לאחר קליטת התשלום.", PAGE.w / 2, footY + 4);
  }

  ctx.fillStyle = stripe;
  ctx.fillRect(0, PAGE.h - 10, PAGE.w, 10);

  return canvas;
}

function line(ctx, x1, x2, y, color = BRAND.line, width = 1.5) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.stroke();
}

/** מקצר טקסט ארוך מדי כדי שלא ידרוס עמודה שכנה */
function clip(ctx, text, maxWidth) {
  let value = String(text ?? "");
  if (ctx.measureText(value).width <= maxWidth) return value;
  while (value.length > 4 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}


/* ==========================================================================
   עטיפת ה-canvas ל-PDF

   מבנה מינימלי של PDF 1.4 עם עמוד אחד ותמונת JPEG פרושה על כל הדף.
   הקובץ נבנה בייט־בייט כי טבלת ה-xref חייבת להצביע על היסטים מדויקים,
   ומחרוזת JS אחת לא הייתה נותנת שליטה כזו על הבייטים הבינאריים.
   ========================================================================== */

function jpegBytes(canvas, quality = 0.92) {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** @returns {Blob} קובץ PDF */
export function canvasToPdf(canvas) {
  const image = jpegBytes(canvas);
  const { width: w, height: h } = canvas;

  const chunks = [];
  const offsets = [];
  let length = 0;

  const push = (data) => {
    const bytes = typeof data === "string"
      ? new TextEncoder().encode(data)
      : data;
    chunks.push(bytes);
    length += bytes.length;
  };

  /** רושם את ההיסט של האובייקט הבא — זה מה שטבלת ה-xref צריכה */
  const obj = (body) => {
    offsets.push(length);
    push(`${offsets.length} 0 obj\n${body}\n`);
  };

  push("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  obj("<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  obj("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  obj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] ` +
      `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj`);

  // אובייקט התמונה — הזרם הבינארי נדחף בנפרד מהמילון
  offsets.push(length);
  push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} ` +
       `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ` +
       `/Length ${image.length} >>\nstream\n`);
  push(image);
  push("\nendstream\nendobj\n");

  const content = `q\n${w} 0 0 ${h} 0 0 cm\n/Im0 Do\nQ`;
  obj(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj`);

  const xrefAt = length;
  let xref = `xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((at) => {
    xref += `${String(at).padStart(10, "0")} 00000 n \n`;
  });
  push(xref);
  push(`trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return new Blob(chunks, { type: "application/pdf" });
}

/** יוצר את קובץ ה-PDF של ההזמנה */
export async function buildInvoicePdf(order) {
  const canvas = await drawInvoice(order);
  const blob = canvasToPdf(canvas);
  // מזהה ההזמנה כבר נושא את קידומת המותג ("LIAD-…"), ולכן אין צורך להוסיף
  const name = `${order.id}.pdf`;
  return { blob, name, file: new File([blob], name, { type: "application/pdf" }) };
}


/* ==========================================================================
   שליחה
   ========================================================================== */

function saveFile(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** ההודעה שמלווה את הקובץ */
function summaryText(order) {
  return [
    `שלום ${order.customer.firstName},`,
    `תודה על ההזמנה מ-${STUDIO.name}!`,
    "",
    `מספר הזמנה: ${order.id}`,
    `סה״כ: ${money(order.totals.total)}`,
    order.shipping.method === "delivery"
      ? `משלוח אל: ${order.shipping.address.street}, ${order.shipping.address.city}`
      : `איסוף עצמי: ${order.shipping.address.pickup}`,
    "",
    "החשבונית מצורפת כקובץ PDF.",
  ].join("\n");
}

/**
 * מנסה לשלוח דרך השרת. מחזיר true אם השליחה בוצעה שם.
 * @param {"email"|"whatsapp"} channel
 */
async function sendViaServer(order, file, channel) {
  if (!INVOICE_ENDPOINT) return false;

  const body = new FormData();
  body.append("channel", channel);
  body.append("orderId", order.id);
  body.append("email", order.customer.email ?? "");
  body.append("phone", order.customer.phone ?? "");
  body.append("invoice", file, file.name);

  const res = await fetch(INVOICE_ENDPOINT, { method: "POST", body });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return true;
}

/**
 * שולח את החשבונית כקובץ PDF.
 *
 * @param {Object} order
 * @param {"email"|"whatsapp"} channel
 * @returns {Promise<{how:"server"|"share"|"download"}>}
 */
export async function sendInvoice(order, channel) {
  const { blob, name, file } = await buildInvoicePdf(order);

  // 1. שרת — השליחה האמיתית, בלי שהלקוחה צריכה לעשות דבר
  if (await sendViaServer(order, file, channel)) return { how: "server" };

  // 2. שיתוף מקורי — בנייד זה מעביר את קובץ ה-PDF עצמו לוואטסאפ או למייל
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({
        files: [file],
        title: `חשבונית ${order.id}`,
        text: summaryText(order),
      });
      return { how: "share" };
    } catch (err) {
      // המשתמשת ביטלה את חלון השיתוף — לא שגיאה
      if (err?.name === "AbortError") return { how: "share" };
    }
  }

  // 3. גיבוי בדסקטופ: הקובץ יורד, והאפליקציה נפתחת עם ההודעה מוכנה
  saveFile(blob, name);

  if (channel === "whatsapp") {
    const phone = normalizePhone(order.customer.phone);
    const text = encodeURIComponent(summaryText(order));
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`,
      "_blank", "noopener");
  } else {
    const subject = encodeURIComponent(`חשבונית ${order.id} · ${STUDIO.name}`);
    const body = encodeURIComponent(summaryText(order));
    window.location.href = `mailto:${order.customer.email}?subject=${subject}&body=${body}`;
  }

  return { how: "download" };
}

/** שומר את החשבונית כקובץ, בלי לשלוח לאף אחד */
export async function downloadInvoice(order) {
  const { blob, name } = await buildInvoicePdf(order);
  saveFile(blob, name);
}

/**
 * ממיר מספר ישראלי לפורמט הבינלאומי שוואטסאפ מצפה לו (972…).
 * מחזיר null אם המספר לא תקין.
 */
export function normalizePhone(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.startsWith("972")) return digits.length >= 12 ? digits : null;
  if (digits.startsWith("0")) return digits.length === 10 ? `972${digits.slice(1)}` : null;
  return digits.length === 9 ? `972${digits}` : null;
}

/* CONFIG מיובא כדי לשמור על מקור אמת אחד למטבע ולפרטי הסטודיו */
export { CONFIG };
