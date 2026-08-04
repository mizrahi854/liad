/* ==========================================================================
   LIAD — חנות | דף אישור הזמנה
   מציג את סיכום ההזמנה ומאפשר שמירה כ-PDF דרך הדפדפן.
   ========================================================================== */

import { $, html, esc, money, getOrder, CONFIG } from "./store.js";
import { initShared } from "./shared.js";

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
      ההזמנה התקבלה ונשמרה. שלחנו את הפרטים גם למייל שהשארת.
    </p>
    <p class="confirmation__order">${esc(order.id)}</p>

    <div class="no-print" style="margin-top:1.5rem;padding:1rem;border:1px dashed var(--border);border-radius:.75rem;background:color-mix(in oklab,var(--muted) 45%,transparent);text-align:start">
      <p style="font-size:.875rem;line-height:1.6;color:var(--muted-foreground)">
        <strong style="color:var(--foreground)">שימו לב:</strong>
        הסליקה עדיין לא חוברה, ולכן <strong>לא בוצע חיוב</strong> ולא נשלח מייל אוטומטי.
        ההזמנה נשמרה בדפדפן בלבד. ראו את ה-README לפירוט מה נדרש להפעלה מלאה.
      </p>
    </div>

    <div class="confirmation__actions">
      <button class="btn btn--gold" onclick="window.print()">שמירת החשבונית כ-PDF</button>
      <a class="btn btn--outline" href="index.html">המשך קנייה</a>
    </div>

    <div class="receipt">
      <h2>חשבונית</h2>

      <div style="display:grid;gap:.5rem;font-size:.875rem;color:var(--muted-foreground);margin-bottom:1.25rem">
        <div style="display:flex;justify-content:space-between;gap:1rem">
          <span>מספר הזמנה</span><span style="color:var(--foreground)">${esc(order.id)}</span>
        </div>
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
        LIAD — אסתטיקה ויופי · rubinliad@gmail.com
      </p>
    </div>`;
}

document.addEventListener("DOMContentLoaded", init);
