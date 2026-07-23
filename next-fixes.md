First Check:


Request URL

https://v.animethemes.moe/KimiNoNaWa-OP1.webm

Request Method

GET

Status Code

206 Partial Content

Remote Address

95.214.235.245:443

Referrer Policy

strict-origin-when-cross-origin

FAIL:

https://v.animethemes.moe/DarlingInTheFranXX-OP1-NCBD1080.webm

Request Method

GET

Status Code

503 Service Unavailable

Referrer Policy

strict-origin-when-cross-origin



<details aria-label="General" open=""><slot id="details-content" pseudo="details-content"><div jslog="Section; context: general"><div class="row "><div class="header-name">Request URL</div><div id="request-url" class="header-value ">https://v.animethemes.moe/BokuNoHeroAcademiaS4-OP1-NCBD1080.webm</div></div><div class="row "><div class="header-name">Request Method</div><div id="request-method" class="header-value ">GET</div></div><div class="row "><div class="header-name">Status Code</div><div id="status-code" class="header-value status red-circle">503 Service Unavailable</div></div><div class="row "><div class="header-name">Referrer Policy</div><div id="referrer-policy" class="header-value ">strict-origin-when-cross-origin</div></div></div></slot></details>

Request URL

https://v.animethemes.moe/BokuNoHeroAcademiaS4-OP1-NCBD1080.webm

Request Method

GET

Status Code

503 Service Unavailable

Referrer Policy

strict-origin-when-cross-origin


OKay status:

Request URL

https://v.animethemes.moe/KimiNoNaWa-OP1.webm

Request Method

GET

Status Code

206 Partial Content

Remote Address

95.214.235.245:443

Referrer Policy

strict-origin-when-cross-origin

</details>

<details open="" aria-label="Response headers"><summary class="header" jslog="SectionHeader; track: click; context: response-headers"><div class="header-grid-container"><div></div><div class="hide-when-closed"></div><div class="hide-when-closed"></div></div></summary>

</details>

<details open="" aria-label="Request Headers"><summary class="header" jslog="SectionHeader; track: click; context: request-headers"><div class="header-grid-container"><div></div><div class="hide-when-closed"></div><div class="hide-when-closed"></div></div></summary>

</details>

---

## Don't forget — Supabase

- Uploads (multer, `data/uploads`) are still on Render's ephemeral disk, NOT migrated to Supabase Storage. Every redeploy wipes uploaded images (tier-list/alignment uploads specifically — everything else pulls from AniList/RAWG URLs directly, so only the "upload from your device" path is at risk). Fix: swap multer's disk storage for a Supabase Storage bucket upload in `server/media.js`'s `/api/upload` route.
- `supabase/schema.sql` has to be re-run manually in the SQL Editor for any NEW Supabase project (e.g. if this one ever gets recreated) — there's no automated migration runner.
- Both `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` need to be set in Render's dashboard env vars (not just local `.env`) for prod to work at all.
