# Shapewise demo video script

**Target length: 3 minutes 40 seconds** (hard limit 4:00). The voiceover is about 520 words, a calm pace of roughly 150 words a minute.

The story in one line: *a bakery sets up its whole ERP by talking to it, then we see a bakery that has run on it for six months, then the owner changes the system by asking.*

---

## Before you record

### Set up
1. **Fresh demo data.** Restart the app (or redeploy) just before recording. The two demo workspaces live in memory and reset on restart, which clears the test sales and shifts made while building.
2. **A signed in, confirmed account** for the onboarding part (Google sign in is quickest). Use a **private window** or a fresh browser profile, so no half finished onboarding is remembered.
3. **The sample file:** `docs/demo-video/price-list.csv` (in this folder). Put it on the desktop so it's one click to attach.
4. **A second tab** open on the Demo Bakery overview: `/w/bakery`.
5. Check Gemini answers: open any workspace, press Ctrl+J, ask "how many customers do I have?". If it answers, AI is working.

### Screen and audio
- Browser window **1440 × 900** or full HD, zoom **100%**, bookmarks bar hidden, notifications off (Windows: Focus assist on).
- Record at **1920 × 1080, 30 fps** (OBS, Loom or the Xbox Game Bar, Win+G).
- Use a headset or USB mic. Record the voiceover **separately** if you can: it's easier to keep timing tight.
- Move the mouse slowly and pause half a second on each thing you name.

### Editing rules
- **Cut AI waiting time** (the setup design takes up to a minute; change drafts about 10 seconds). Put a small "sped up" or "2× speed" label on those clips, so judges know it's honest.
- Never cut out a result: always show the answer appearing.
- No music under the voice, or keep it very quiet.

---

## The script

Each scene says **what's on screen**, **what to do** (exact clicks and text), and **what to say**.

### Scene 1 · The problem (0:00 to 0:15)

**Screen:** the Shapewise home page, the hero with the moving particle shape.

**Do:** nothing. Let the animation form the logo and then the invoice.

**Say:**
> "Small manufacturers run on spreadsheets, because ERP software needs consultants and months of setup. Shapewise is an ERP that sets itself up from a conversation, built on Gemini."

---

### Scene 2 · Set up a business by talking (0:15 to 1:20)

**Screen:** signed in. Click **Set up my business**, then **Set up with AI**.

**Do, step by step:**

1. In **Tell me about your business**, type:
   > Harbour Bakes. We bake bread, cakes and pastries. We sell at our own counter and deliver to cafés and two hotels on monthly credit.
2. Click the paperclip (**Attach a price list, an invoice or a photo of a job card**) and choose `price-list.csv`. Press send.

   **Say:**
   > "I'll set up a bakery. One sentence about the business, and our price list."

3. The panel on the right (**Your details**) fills in as Gemini reads the file. Answer each question by **tapping the suggested answer** when it fits. Use this answer bank for whatever it asks:

   | If it asks about… | Tap or type |
   |---|---|
   | Country | **Singapore** |
   | Number of people | the band for **about 12** |
   | Yearly sales | the **middle** band |
   | Tax registration | **GST registered** |
   | Products or what you make | tap the bread, cake and pastry options it suggests |
   | Make to order or for stock | **Both** (or "For stock" if both isn't offered) |
   | Recipes or ingredients | **Yes**, we bake from recipes and track flour, butter, sugar and eggs |
   | Shelf life, batches or expiry | **Yes**, cakes and pastries last about 3 days |
   | Who buys on credit / payment terms | **Cafés and hotels, 30 days** |
   | Staff roles | **Owner, Manager, Baker, Cashier** |
   | Documents | **Invoice, Delivery note, Receipt, Purchase order** |
   | Approvals | type: **Purchase orders over 2,000 need my approval** |
   | Reports | **Daily takings, Running low, Profit** |
   | Where reports show | **Dashboard** and **Morning email** |

   **Say (while tapping):**
   > "Gemini reads the file first, then asks only what it still needs, and most answers are a tap. Country, size and tax questions are asked by code, so tax rules are exact, not guessed. And I can set rules in my own words: purchase orders over two thousand need my approval."

4. When the button appears, click **Build when you're ready**.
   *Edit: cut the "Designing your setup" wait down to about 3 seconds and label it "sped up".*

5. The **review** appears. Scroll slowly through: **What you'll use**, **How it connects** (hover one document to trace its path), **People and permissions**, **Approvals** (your 2,000 rule is there).

   **Say:**
   > "Nothing is created until I approve the plan: the screens I'll use, how each document leads to the next, what moves stock and posts to the books, who can do what, and the approval I asked for. Gemini proposes the design; code validates every part of it."

6. In **Workspace address**, type `harbour-bakes` (add a number if it's taken). Click **Create my workspace**.

   **Say:**
   > "One click, and it's a working system."

---

### Scene 3 · The new workspace (1:20 to 1:30)

**Screen:** Harbour Bakes opens on its overview. Open **Inventory › Items** for two seconds to show the price list came in.

**Say:**
> "Our items are already loaded. To show daily work, here's a bakery that's been running on Shapewise for six months."

**Do:** switch to the **Demo Bakery** tab (`/w/bakery`).

---

### Scene 4 · Selling and sending (1:30 to 2:05)

**Do:**
1. On the Demo Bakery **Overview**, pause one second on the key figures.
2. Open **Sales › Invoices** and click the newest invoice (**INV-2026-00052**, Green Cabin).
3. Click **Send**, then **Copy**. Open a new tab, paste, press Enter. The customer's view opens. Click **Open PDF**.

   **Say:**
   > "Every posted invoice has a PDF and a link the customer opens on their phone, sent by WhatsApp or email."

4. Go to **Point of sale › Terminal**. Click **Start shift** (keep the float as it is). Tap **Butter croissant** three times and **Chocolate cake 1 kg** once. Choose **Card**, click **Charge**.

   **Say:**
   > "At the counter, the till rings up sales. Closing the shift posts the takings and the stock to the books, with cash and card kept apart."

---

### Scene 5 · Production and quality (2:05 to 2:30)

**Do:**
1. Open **Production › Floor**. Pause on the board: Scheduled, In progress, the late order in red.
2. Open **Production › Quality control**. On the first batch waiting, click **Release to stock**.

**Say:**
> "Production runs from recipes. Each batch waits for a quality check, and releasing it moves the output into stock, with lots and expiry dates tracked, so a recall is one search."

---

### Scene 6 · The books keep themselves (2:30 to 2:50)

**Do:**
1. Open **Accounting › Trial balance**. Point at the green **The books balance** badge.
2. Click the **Financial statements** screen (Accounting menu). The profit and loss shows.

**Say:**
> "Every document writes its own double entry. The trial balance always balances, and the profit and loss is worked out from those postings, never typed in."

---

### Scene 7 · Change the system by asking (2:50 to 3:20)

**Do:**
1. Open **Governance › System changes**.
2. In **Describe a change**, type:
   > Add a cake message to each sales order line, so the bakers know what to write on the cake
3. Click **Draft the change**. *(Takes about 10 seconds; cut it down and label "sped up".)*
4. The draft shows: **Adds "Cake Message" to sales orders, on each line.** Click **Apply this change**.
5. Open **Sales › Sales orders** and click **New sales order**. Point at the new **Cake Message** column on the lines.
6. Go back to **System changes** and click **Undo the last change** (confirm with OK).

**Say:**
> "When the business changes, I just ask. Gemini drafts the change, code checks it against the setup, and I see exactly what it will do. Apply, and it's live: here's the new column. Every change is a version, so it can be undone."

---

### Scene 8 · Ask your numbers (3:20 to 3:35)

**Do:** press **Ctrl+J** (or click **Ask AI or query numbers…** at the top). Type:
> Who are my top 3 customers this month?

Let the answer appear (it shows what it looked up as it works).

**Say:**
> "Anyone can ask questions in plain words. The assistant answers from our own records, and can only act through the same checked pipeline as everyone else."

---

### Scene 9 · Close (3:35 to 3:45)

**Screen:** back to the home page hero (or the architecture slide from the submission deck).

**Say:**
> "Shapewise: an ERP that takes the shape of your business. Every change goes through one pipeline with permissions, approvals and an audit trail. Try the demos at shapewise dot web dot app."

**On screen text (last 3 seconds):** `shapewise.web.app · github.com/harshamal/shapewise`

---

## Timing check

| Scene | Length | Runs to |
|---|---|---|
| 1 · Problem | 15 s | 0:15 |
| 2 · Set up by talking | 65 s | 1:20 |
| 3 · New workspace | 10 s | 1:30 |
| 4 · Selling and sending | 35 s | 2:05 |
| 5 · Production and quality | 25 s | 2:30 |
| 6 · Books | 20 s | 2:50 |
| 7 · Change by asking | 30 s | 3:20 |
| 8 · Ask your numbers | 15 s | 3:35 |
| 9 · Close | 10 s | **3:45** |

If you run long, shorten in this order: Scene 3 (just say the line over a cut), Scene 5 (skip the floor board), Scene 4 (skip the PDF, keep the customer's view). Don't cut Scenes 2 or 7: they're what judges remember.

## If something goes wrong while recording
- **The interview asks something not in the table:** tap the first suggested answer that's roughly right. The review lets you fix anything.
- **"Build when you're ready" doesn't appear:** answer one more question; it appears once there's enough to design from.
- **The workspace address is taken:** add a number, e.g. `harbour-bakes-2`.
- **AI is slow or errors:** record Scene 2 and Scene 7 on their own and splice them in. Everything else works without AI.
- **A screen looks empty in the demo:** restart the app to reset the demo data, then record that scene again.

## Note on currency
The demo workspaces are set up in rupees (amounts show "Rs"). If you'd rather the video shows no country specific currency, ask to switch the demos to another currency before recording.
