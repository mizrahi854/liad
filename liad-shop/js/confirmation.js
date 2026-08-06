/* ==========================================================================
   LIAD — חנות | דף אישור הזמנה
   מציג את סיכום ההזמנה ומאפשר שמירה כ-PDF דרך הדפדפן.
   ========================================================================== */

import { $, html, esc, money, getOrder, CONFIG, toast } from "./store.js";
import { initShared } from "./shared.js";
import { sendInvoice, downloadInvoice } from "./invoice.js";

function init() {
  initShared();

  const id = new URLSearchParams(location.search).get("order");
  const order = id ? getOrder(id) : null;
  const box = $("#confirmation");

  if (!order) {
    box.innerHTML = `
      <h1>ההזמנה לא נמצאה</h1>
      <p style="margin-top:1rem;color:var(--muted-foreground)">
        ייתכן שהקישור פג או שההזמנה בוצעה בדפדפן אחר.
      </p>
      <div class="confirmation__actions">
        <a class="btn btn--gold" href="index.html">חזרה לחנות</a>
      </div>`;
    return;
  }

  const date = new Date(order.createdAt).toLocaleDateString("he-IL", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  const address = order.shipping.method === "delivery"
    ? [
        order.shipping.address.street,
        order.shipping.address.apartment && `דירה ${order.shipping.address.apartment}`,
        order.shipping.address.city,
        order.shipping.address.zip,
      ].filter(Boolean).join(", ")
    : `איסוף עצמי — ${order.shipping.address.pickup}`;

  const rows = order.items.map((it) => `
    <tr>
      <td style="padding:.625rem 0">${esc(it.title)}</td>
      <td style="padding:.625rem 0;text-align:center;font-variant-numeric:tabular-nums">${it.qty}</td>
      <td style="padding:.625rem 0;text-align:left;font-variant-numeric:tabular-nums">${money(it.lineTotal)}</td>
    </tr>`).join("");

  box.innerHTML = `
    <div class="confirmation__mark">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
    </div>

    <h1>תודה, ${esc(order.customer.firstName)}!</h1>
    <p style="margin-top:1rem;color:var(--muted-foreground)">
      ההזמנה התקבלה ונשמרה. אפשר לשלוח את החשבונית כקובץ PDF למייל או לוואטסאפ.
    </p>
    <p class="confirmation__order">${esc(order.id)}</p>

    <div class="no-print" style="margin-top:1.5rem;padding:1rem;border:1px dashed var(--border);background:color-mix(in oklab,var(--muted) 45%,transparent);text-align:start">
      <p style="font-size:.875rem;line-height:1.6;color:var(--muted-foreground)">
        <strong style="color:var(--foreground)">שימו לב:</strong>
        הסליקה עדיין לא חוברה, ולכן <strong>לא בוצע חיוב</strong>.
        ההזמנה נשמרה בדפדפן בלבד. ראו את ה-README לפירוט מה נדרש להפעלה מלאה.
      </p>
    </div>

    <div class="confirmation__actions">
      <button class="btn btn--gold" id="mailSend">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>
        </svg>
        שליחת החשבונית למייל
      </button>
      <button class="btn btn--whatsapp" id="waSend">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.48-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.01-1.04 2.48s1.06 2.87 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.69.63.71.22 1.36.19 1.87.12.57-.09 1.75-.72 2-1.41.25-.69.25-1.28.17-1.41-.07-.13-.27-.2-.57-.35z"/>
          <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5.05-1.32A10 10 0 1 0 12 2m0 1.8a8.2 8.2 0 1 1-4.18 15.26l-.3-.18-3 .78.8-2.92-.19-.31A8.2 8.2 0 0 1 12 3.8"/>
        </svg>
        שליחה בוואטסאפ
      </button>
      <button class="btn btn--outline" id="savePdf">הורדת ה-PDF</button>
      <a class="btn btn--outline" href="order.html?id=${encodeURIComponent(order.id)}">מעקב אחר ההזמנה</a>
      <a class="btn btn--outline" href="index.html">המשך קנייה</a>
    </div>

    <p class="confirmation__hint no-print" id="sendHint" role="status" aria-live="polite"></p>

    <div class="receipt" id="receipt">
      <div class="receipt__head">
        <img class="receipt__logo" src="assets/liad-logo.png" alt="LIAD — אסתטיקה ויופי" width="150" height="48">
        <div class="receipt__meta">
          <p class="receipt__label">חשבונית</p>
          <p class="receipt__number">${esc(order.id)}</p>
        </div>
      </div>

      <div style="display:grid;gap:.5rem;font-size:.875rem;color:var(--muted-foreground);margin-bottom:1.25rem">
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>תאריך</span><span style="color:var(--foreground)">${esc(date)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>לקוחה</span>
          <span style="color:var(--foreground)">${esc(order.customer.firstName)} ${esc(order.customer.lastName)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>טלפון</span><span style="color:var(--foreground)">${esc(order.customer.phone)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>אימייל</span><span style="color:var(--foreground)">${esc(order.customer.email)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>${order.shipping.method === "delivery" ? "כתובת למשלוח" : "איסוף"}</span>
          <span style="color:var(--foreground);text-align:left">${esc(address)}</span>
        </div>
        ${order.notes ? `
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>הערות</span><span style="color:var(--foreground);text-align:left">${esc(order.notes)}</span>
        </div>` : ""}
      </div>

      <table style="width:100%;border-collapse:collapse;font-size:.9375rem">
        <thead>
          <tr style="border-bottom:1px solid var(--border);font-size:.75rem;letter-spacing:.15em;color:var(--muted-foreground)">
            <th style="padding-bottom:.5rem;text-align:start;font-weight:400">מוצר</th>
            <th style="padding-bottom:.5rem;text-align:center;font-weight:400">כמות</th>
            <th style="padding-bottom:.5rem;text-align:left;font-weight:400">סכום</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div style="margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--border)">
        <div class="summary-row"><span>סכום ביניים</span>
          <span class="summary-row__value">${money(order.totals.subtotal)}</span></div>
        ${order.totals.discount > 0 ? `
        <div class="summary-row summary-row--free">
          <span>הנחה (${esc(order.totals.coupon)})</span>
          <span class="summary-row__value">−${money(order.totals.discount)}</span></div>` : ""}
        <div class="summary-row"><span>משלוח</span>
          <span class="summary-row__value">${order.totals.shipping === 0 ? "חינם" : money(order.totals.shipping)}</span></div>
        <div class="summary-row summary-row--total"><span>סה״כ</span>
          <span class="summary-row__value">${money(order.totals.total)}</span></div>
      </div>

      <p style="margin-top:1.5rem;font-size:.75rem;color:var(--muted-foreground);text-align:center">
        LIAD — אסתטיקה ויופי · rubinliad@gmail.com · מתחם הפיל, בנימינה
      </p>
    </div>`;

  wireSending(order);
}

/* ---------------------------------------------------------------- שליחה */

/*
 * שלושת הכפתורים עובדים על אותו קובץ PDF אמיתי שנבנה ב-js/invoice.js.
 * ההודעה שמתחת לכפתורים אומרת בדיוק מה קרה, כי התוצאה שונה בין מכשירים:
 * בנייד הקובץ עובר ישירות לוואטסאפ/למייל, ובדסקטופ הוא יורד והאפליקציה
 * נפתחת עם ההודעה מוכנה לצידו.
 */
function wireSending(order) {
  const hint = $("#sendHint");

  const run = async (button, channel, labels) => {
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = "מכין את החשבונית…";
    hint.textContent = "";

    try {
      const { how } = await sendInvoice(order, channel);
      hint.dataset.state = "success";
      hint.textContent = labels[how];
    } catch (err) {
      console.error("[LIAD] שליחת החשבונית נכשלה:", err);
      hint.dataset.state = "error";
      hint.textContent = "לא הצלחנו להכין את החשבונית. אפשר לנסות שוב.";
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  };

  $("#mailSend").addEventListener("click", (e) => run(e.currentTarget, "email", {
    server: "החשבונית נשלחה למייל שלך.",
    share: "החשבונית הועברה לאפליקציית המייל כקובץ מצורף.",
    download: "קובץ ה-PDF ירד ותוכנת המייל נפתחה — נשאר רק לצרף אותו ולשלוח.",
  }));

  $("#waSend").addEventListener("click", (e) => run(e.currentTarget, "whatsapp", {
    server: "החשבונית נשלחה בוואטסאפ.",
    share: "החשבונית הועברה לוואטסאפ כקובץ מצורף.",
    download: "קובץ ה-PDF ירד ווואטסאפ נפתח — נשאר רק לצרף אותו ולשלוח.",
  }));

  $("#savePdf").addEventListener("click", async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    try {
      await downloadInvoice(order);
      toast("קובץ החשבונית ירד");
    } catch (err) {
      console.error("[LIAD] יצירת ה-PDF נכשלה:", err);
      toast("יצירת הקובץ נכשלה", "info");
    } finally {
      button.disabled = false;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
