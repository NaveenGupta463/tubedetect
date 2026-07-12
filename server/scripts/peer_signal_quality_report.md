# Peer Signal Quality Audit

**Date:** 2026-06-14  
**Total distinct peer titles:** 102  
**Usable (ADAPTABLE + NARRATIVE):** 15 (15%)  
**Noise / unusable:** 87 (85%)  

## Category Breakdown

| Category | Count | % | Gold labels |
|---|---|---|---|
| Adaptable to creator context | 8 | 8% | Good:2, Average:5, Garbage:1 |
| Narrative (Excellent pattern) | 7 | 7% | Average:3, Excellent:4 |
| English — no strong pattern | 30 | 29% | Average:23, Poor:6, Garbage:1 |
| Entertainment / vlog / challenge | 8 | 8% | Average:8 |
| Too short / vague (< 4 words) | 16 | 16% | Garbage:4, Poor:9, Average:3 |
| Spam: episode / serial show | 10 | 10% | Average:7, Poor:3 |
| Spam: brand promo / @mention | 6 | 6% | Average:3, Garbage:1, Poor:2 |
| Hindi / non-Latin script | 12 | 12% | Poor:4, Average:8 |
| Other language (romanized) | 5 | 5% | Average:2, Poor:3 |

## Why only 13/102 were usable

**12 — Hindi / non-Latin script**  
Root cause: buildPeerVideoSignalIdeas() only blocks Marathi/Telugu/Tamil/Kannada/Malayalam/Bengali — Hindi passes through  

**5 — Other language (romanized)**  
Root cause: No romanized-language detector in ingestion filter  

**10 — Spam: episode / serial**  
Root cause: No episode-number or show-name filter in cleanPeerSignalTitle()  

**6 — Spam: promo / @mention**  
Root cause: No promotional content filter in ingestion  

**16 — Too short / vague**  
Root cause: No minimum meaningful word count gate  

**8 — Entertainment / vlog noise**  
Root cause: Entertainment format titles pass all current filters  

**30 — English — no strong pattern**  
Root cause: English and clean but no pattern match — borderline quality  

## Recommended Ingestion Filters (priority order)

1. **Hindi language block** in `buildPeerVideoSignalIdeas()`: add Hindi stop-words to the language filter alongside the existing regional language list.
2. **Romanized South Indian language block**: detect Tamil/Telugu romanized patterns.
3. **Episode / serial filter**: reject titles with `/\b(episode|ep\b|part \d+|by \w+ tv)\b/i`.
4. **Promotional content filter**: reject titles with `/@\w+|presented by|buy now/i`.
5. **Minimum word count gate**: require ≥ 4 meaningful words in `cleanPeerSignalTitle()`.
6. **English-only gate**: non-Latin character ratio < 5% (already enforced in hybridRecommendationGenerator).

## Impact Projection

After applying all 6 filters:
- Noise removed: ~54 titles
- Estimated usable pool: ~48 / 102 (47%)
- CHECKLIST_FORMAT gap: currently 0 active peer examples — Hindi/noise block will not fix this. Need English creators with checklist-style content in the peer pool.

## Titles by Category

### Adaptable to creator context (n=8)

- "Mumbai Style Vada Pav With Garlic Chutney ASMR Cooking" — **Good**
- "Making Biggest Burger of My City" — **Average**
- "Introducing Gemini Omni: Create Anything from Anything" — **Average**
- "I Turned My School Bus Into A FISH TANK" — **Average**
- "How Trump’s China Visit Impacts India" — **Good**
- "How Long Will We Live in Fear?” Abhijeet Dipke as Sonam Wangchuk Joins CJP Protest" — **Average**
- "Gazab Jugaad 🤯💀🔥 Fish tank se poora Space bana diya" — **Average**
- "CJP Protests LIVE: Cockroach Janta Party's 1st Protest" — **Garbage**

### Narrative (Excellent pattern) (n=7)

- "Why So Many Tornadoes Happen HERE" — **Average**
- "What if you dropped a bowling ball in the Mariana Trench" — **Average**
- "We Thought Black Holes Ended in Singularities. They Might End In a Frozen Big Bang" — **Excellent**
- "Trump Can’t Negotiate for S**t, and the Iran Peace Talks Prove It" — **Excellent**
- "This Tiny Chip Could Make Google's Quantum Computer 1,000× Better" — **Average**
- "The Tiger That Was Forced to Hunt Humans" — **Excellent**
- "A Santro, A Family and 20 Years of Memories" — **Excellent**

### English — no strong pattern (n=30)

- "It’s Impossible To Make Me Mad" — **Average**
- "Don't Eat The Spicy Chocolate" — **Average**
- "Bro used his six sense" — **Poor**
- "we literally can’t believe this!! we won 3 American Music Awards? EYEKONS, we owe it all to you" — **Average**
- "this took way too much effort to film" — **Average**
- "Why Trump’s Reflecting Pool Repairs Are in Trouble" — **Average**
- "Why Trump Flew to China with 18 CEOs" — **Average**
- "Wallet wali photo ka sach" — **Poor**
- "Top U.S. & World Headlines — May 28, 2026" — **Average**
- "The Real Strength of India Is Unity" — **Average**
- "Summer ka Best Business = Electric Ghana Machine" — **Average**
- "She also wanted people to clap for her dance" — **Average**
- "She Was Watching Him Trick the Pigeons Easily… But The Third One Was Smarter" — **Average**
- "RBI Launch Plastic Notes? Big Update for Indian Currency" — **Average**
- "Mobile Phone kitchen 💼 kitchen, multiple variety, knife, toys, kitchen starting only for 50rs" — **Garbage**
- "Me after getting handsome boy" — **Average**
- "Magical Mom Surprise After Kartik Draws Near the Window" — **Average**
- "Jumping from the World Trade Center" — **Average**
- "Iran Israel War Live" — **Poor**
- "Insta profile names paridhabangal" — **Poor**
- "I EXPOSED BUGATTI'S SERVICE & REPAIR COST'S" — **Average**
- "Hit The Button, Win $1,000" — **Average**
- "Google Maps is unreasonably fast. Let me explain" — **Average**
- "Fighting with a Girl’s Girl" — **Average**
- "Engagement Date 💍 || Poonam P Bisht" — **Average**
- "Double it and Give it to the Next Person" — **Average**
- "Bua ji in Parallel Universe" — **Average**
- "ABC World News Tonight with David Muir Full Broadcast - May 8, 2026" — **Average**
- "1st meeting with KUSUM" — **Poor**
- "Shadow Ke Sath Bura😞💔 Hua" — **Poor**

### Entertainment / vlog / challenge (n=8)

- "We Made a Giant Cardboard City" — **Average**
- "Testing a Giant Bubble Gun" — **Average**
- "OMG Toy Thar Vs Real Thar Unboxing" — **Average**
- "Getting ready for Manju’s baby shower🐹| Anju Mor" — **Average**
- "Eating the world's biggest pop rock" — **Average**
- "Confronting Axe Murderer at Haunted Magnolia Hotel" — **Average**
- "5 Real News Headlines vs 1 Fake Story" — **Average**
- "10 Things I Bought My BACKYARD" — **Average**

### Too short / vague (< 4 words) (n=16)

- "TOWEL BALL" — **Garbage**
- "new song" — **Garbage**
- "Sundar + multi purpose" — **Poor**
- "Smartphone VS Moon Shot" — **Poor**
- "RIP Godi Media" — **Poor**
- "Impossible Football Challenge" — **Poor**
- "IPL Final" — **Garbage**
- "He is torturing pizza AGAIN" — **Average**
- "Green Flag" — **Garbage**
- "Don't Pop the Football" — **Poor**
- "Chota bachcha janke" — **Poor**
- "Chernobyl’s Black Frogs" — **Poor**
- "Bride’s sister at the wedding" — **Average**
- "Birthday 🎂 cake" — **Poor**
- "A lineup skin counts on" — **Average**
- "1 Hour Fried Chicken" — **Poor**

### Spam: episode / serial show (n=10)

- "NEW! Taarak Mehta Ka Ooltah Chashmah" — **Average**
- "Very Special Trending Comedy Video 2026 😂Amazing Comedy Funny Video Episode 269 By Our Fun Tv" — **Average**
- "Funniest Fun Comedy Video 2026 😂 amazing comedy video 2026 Episode 266 By Our Fun Tv" — **Average**
- "Raakh - Official Trailer" — **Poor**
- "Ladies Special 2" — **Poor**
- "Anniyan - Back to Back Comedy Scenes" — **Average**
- "Top Funniest Fun New Comedy Video 😂 Special amazing funny video 2026 Ep 381 By Busy Fun Ltd" — **Average**
- "Shaidai Episode 12 Presented by Ujooba Beauty Cream - Happilac Paints & Berg Snow Fall" — **Average**
- "Episode 1: The Future Guy Arrives" — **Average**
- "Android smartwatch V/S Smartphone Part 15" — **Poor**

### Spam: brand promo / @mention (n=6)

- "Uday Doctor Comedy || Binesar Chacha Comedy @UdaydoctorBodhgaya" — **Average**
- "The Hyderabad sky lighting up with vivo X300 FE & vivo X300 Ultra that took over the night. Buy Now" — **Garbage**
- "Have you watched this vlog on @Missfunvlogs" — **Average**
- "Crypto & Gold Analysis The Trade Room - Mayank Raj" — **Average**
- "Brick Dominos 🧱 @zackdfilms" — **Poor**
- "I Warned Them @Lionfield @ChefRush" — **Poor**

### Hindi / non-Latin script (n=12)

- "Khajur ne kiya Makeup" — **Poor**
- "Bhook lagri thi 😭💀 bhari mistake hogyi" — **Average**
- "Anaya Ki Birthday Party Par Koi Nhi Aaya" — **Average**
- "start हो गया 🏡🧿🥹| Aarti sahu" — **Average**
- "Mansi ka funny dance" — **Poor**
- "After love marriage ससुराल की हवा बाजी 😂 social simran" — **Average**
- "inn sabziyon ne meri feed cook kar di hai" — **Average**
- "Rishabh ne apna khana kisko khilaya" — **Average**
- "Karela NHI khayega" — **Poor**
- "2 Lakh ki bike chori ho gai" — **Poor**
- "Ghar Mein Bl@st Hogya🥲🥲 Bura Hua" — **Average**
- "Aaj Ghar pe Bnaya Fanta with Soda Maker" — **Average**

### Other language (romanized) (n=5)

- "Mo family ku mu manigali muni soumya official" — **Average**
- "Kesi dillagi h tu" — **Poor**
- "HABLÉ CON MINI MINI.EXE EN LOS BACKROOMS" — **Average**
- "Feel panna vidunga da" — **Poor**
- "Dini peru cheppandi chudham" — **Poor**
