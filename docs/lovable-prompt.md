# Lovable prompt

Paste this into Lovable, changing the three values at the top. It builds the booking page and the manage page, and leaves the design to match the rest of your site.

```
Add a booking feature that talks to our booking API. Do not add a backend, it is all client side fetch calls.

API base URL: https://book.example.com
Site key: example
Booking page route: /book
Manage page route: /booking/manage

1. Create src/lib/booking.ts with typed functions for these endpoints. All return JSON, errors come back as { error: string } with a non 200 status, so throw an Error with that message.
   - GET  /api/config?site=SITE  -> { site: { key, name, host }, turnstileSiteKey, meetingTypes: [{ slug, name, description, durationMins, questions: [{ key, label, type: "text" | "textarea" | "select", options: string[], required }] }] }
   - GET  /api/availability?site=SITE&type=SLUG&from=YYYY-MM-DD&to=YYYY-MM-DD -> { timezone, durationMins, slots: string[] }  (slots are UTC ISO strings)
   - POST /api/book  body { site, type, start, name, email, answers: Record<string,string>, timezone, turnstileToken } -> { id, start, end, joinUrl, manageToken, manageUrl }
   - GET  /api/booking?token=TOKEN -> { site, type, typeName, name, start, end, status, joinUrl }
   - POST /api/reschedule body { token, start, turnstileToken } -> { ok, start, end }
   - POST /api/cancel body { token, reason } -> { ok }

2. Booking page at the booking route:
   - Load config. If there is more than one meeting type, show them as cards first. If only one, skip straight to it.
   - Show a month calendar. Fetch availability for the visible range (max 6 weeks per call). Days with no slots are disabled.
   - Clicking a day shows its time slots as buttons, formatted in the visitor's own time zone (Intl.DateTimeFormat().resolvedOptions().timeZone). Show that time zone name above the slots, with a dropdown to change it.
   - After picking a slot, show a form: name, email, then the meeting type's questions in order, rendering text, textarea or select. Respect required.
   - Render a Cloudflare Turnstile widget using turnstileSiteKey (load https://challenges.cloudflare.com/turnstile/v0/api.js). Disable submit until it has a token.
   - On submit call /api/book with timezone set to the visitor's time zone. On a 409, show the error, refresh availability and send them back to the time picker.
   - On success show a confirmation screen with the date and time, a Join Teams link if joinUrl is present, and a note that a calendar invite is on its way.

3. Manage page at the manage route:
   - Read ?token= from the URL and load /api/booking.
   - If cancelled, say so. Otherwise show the booking with two options: Reschedule (same calendar and slot picker as the booking page, then /api/reschedule with a Turnstile token) and Cancel (optional reason, confirm, then /api/cancel).

Match the existing design system, fonts and colours. Use British English. Make it work well on mobile.
```
