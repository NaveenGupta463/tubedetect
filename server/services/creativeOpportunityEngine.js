'use strict';

// ── Family configs ────────────────────────────────────────────────────────────
// Each family defines detection patterns for axes (format, mood, occasion, language).
// A peer video's title is classified against these patterns.
// Scoring runs per-axis first (always), per-combination only when evidence is strong.

const FAMILY_CONFIG = {
  music: {
    opportunity: { min_lift: 0.75, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.85, combo_max_rarity: 90, combo_min_videos: 2, combo_min_channels: 1 },
    formats: {
      cover:         /\bcover\b/i,
      acoustic:      /\b(acoustic|unplugged)\b/i,
      lyric_video:   /\blyrics?\b|\blyric\s*video\b/i,
      live_session:  /\blive\s*(session|performance|version|at\s)\b|\blive$/i,
      mashup:        /\bmashup\b/i,
      reprise:       /\breprise\b/i,
      slowed_reverb: /\b(slowed|reverb|lo[\s-]?fi)\b/i,
      instrumental:  /\binstrumental\b/i,
      behind_song:   /\bbehind\s+(the\s+)?(song|scene)|\bmaking\s+of\b/i,
      medley:        /\b(medley|jukebox)\b/i,
      original:      /\boriginal\s*(song|track|composition|music)?\b/i,
      hook_clip:     /\bhook\s+clip\b|\btrending\s+hook\b/i,
      remix:         /\b(remix|refix|mix\s+version|club\s+mix)\b/i,
      dj_mix:        /\b(dj\s+mix|nonstop|dance\s+mix|bass\s+boosted)\b/i,
      status_edit:   /\b(status|whatsapp\s+status|reel\s+audio|shorts?\s+audio|edit\s+audio)\b/i,
      karaoke:       /\b(karaoke|minus\s+one|backing\s+track)\b/i,
      ringtone:      /\b(ringtone|caller\s+tune|alarm\s+tone)\b/i,
      studio_version:/\b(studio\s+version|official\s+audio|audio\s+song)\b/i,
      performance:   /\b(stage\s+show|concert|performance|singing\s+live|live\s+singing)\b/i,
      music_video:   /\b(official\s+video|video\s+song|music\s+video|full\s+video|hd\s+video)\b/i,
      lyrical_status:/\b(lyrical|lyrical\s+video|lyrics\s+status|status\s+video)\b/i,
    },
    moods: {
      romantic:    /\bromantic\b|\blove\s+(song|track)\b/i,
      heartbreak:  /\bheartbreak\b|\bsad\s+(song|track|love)\b|\bdard\b|\bdukh\b|\bteri\s+yaad\b/i,
      devotional:  /\bdevotional\b|\bbhajan\b|\bprayer\s+song\b/i,
      party:       /\bparty\b|\bclub\b|\bdance\s+(song|track|banger)\b|\bdhol\b/i,
      lofi:        /\blo[\s-]?fi\b|\bchill\b|\bsleep\s+music\b|\bambient\b/i,
      nostalgia:   /\bnostalgi\w*\b|\bclassic\b|\bretro\b|\bthrowback\b|\bold\s+(song|track)\b/i,
      high_energy: /\benergy\b|\bpumped\b|\bhype\b|\bupbeat\b|\bbanger\b/i,
      dance:       /\bdance\b|\bchoreography\b|\bgarba\b|\bbhangra\b|\bdj\b/i,
      folk:        /\bfolk\b|\bdesi\b|\btraditional\b|\b lok geet\b|\bgaan\b/i,
      regional:    /\b(haryanvi|rajasthani|odia|assamese|kannada|malayalam|marathi|bengali|bhojpuri|telugu|tamil|gujarati|punjabi)\b/i,
    },
    occasions: {
      wedding:   /\b(wedding|shaadi|vivah|mehndi|sangeet|baraat)\b/i,
      festival:  /\b(diwali|holi|navratri|ganesh|eid|garba|durga|krishna|hanumanji|onam)\b/i,
      valentine: /\bvalentine\b/i,
      monsoon:   /\b(monsoon|barish|sawan)\b/i,
      farewell:  /\b(farewell|graduation|convocation)\b/i,
    },
    languages: {
      hindi:    { script: /[ऀ-ॿ]/, keyword: /\bhindi\b/i },
      punjabi:  { script: /[਀-੿]/, keyword: /\bpunjabi\b|\bjatt\b|\bpagg\b/i },
      tamil:    { script: /[஀-௿]/, keyword: /\btamil\b|\bkollywood\b/i },
      telugu:   { script: /[ఀ-౿]/, keyword: /\btelugu\b|\btollywood\b/i },
      gujarati: { script: /[઀-૿]/, keyword: /\bgujarati\b|\bgarba\b/i },
      marathi:  { script: null,               keyword: /\bmarathi\b/i },
      bengali:  { script: /[ঀ-৿]/, keyword: /\bbengali\b|\bbengali\s+(song|music)\b/i },
      bhojpuri: { script: null,               keyword: /\bbhojpuri\b/i },
      urdu:     { script: /[؀-ۿ]/, keyword: /\burdu\b/i },
      english:  { script: null,               keyword: /\benglish\b/i },
    },
  },

  devotional: {
    opportunity: { min_lift: 0.95, max_rarity: 90, min_peer_count: 1, combo_min_lift: 1.0, combo_max_rarity: 80, combo_min_videos: 3, combo_min_channels: 2 },
    formats: {
      bhajan:   /\bbhajan\b/i,
      aarti:    /\baarti\b/i,
      mantra:   /\bmantra\b|\bjap\b|\bchanting\b|\bchant\b/i,
      kirtan:   /\bkirtan\b/i,
      stotra:   /\b(stotra|stuti|chalisa)\b/i,
      katha:    /\b(katha|pravachan|discourse|satsang)\b/i,
      guided:   /\bguided\b|\bmeditation\b/i,
      live_darshan: /\b(live\s+darshan|darshan|temple\s+live|mandir)\b/i,
      devotional_loop: /\b(loop|1\s*hour|2\s*hours?|nonstop|morning\s+prayer|sleep)\b/i,
      paath:    /\b(paath|path|sunderkand|sundarkand|ramayan|bhagwat|gita|geeta|quran\s+recitation)\b/i,
      shabad:   /\b(shabad|gurbani|waheguru|nitnem|ardas)\b/i,
      qawwali:  /\b(qawwali|naat|hamd|dua|zikr|dhikr|islamic\s+song|nasheed)\b/i,
      gospel:   /\b(gospel|worship\s+song|christian\s+song|praise\s+and\s+worship|prayer\s+song)\b/i,
      ringtone: /\b(ringtone|caller\s+tune|status|whatsapp\s+status|shorts?)\b/i,
    },
    moods: {
      morning:    /\b(morning|suprabhat|subah|daily|everyday)\b/i,
      sleep_calm: /\b(sleep|calm|peaceful|relaxing|meditation|healing|positive\s+energy)\b/i,
      protection: /\b(protection|raksha|remove\s+negative|negative\s+energy|powerful)\b/i,
      shiva:      /\b(shiva|mahadev|bholenath|rudra|om\s*namah)\b/i,
      krishna:    /\b(krishna|radha|gopal|kanha|govind)\b/i,
      ram:        /\b(ram|rama|hanuman|sita|sunderkand|sundarkand)\b/i,
      devi:       /\b(durga|devi|mata|maa|lakshmi|saraswati|kali|ambe)\b/i,
      sai:        /\b(sai|shirdi|sai\s+baba)\b/i,
    },
    occasions: {
      navratri:    /\b(navratri|garba|durga|devi|dandiya)\b/i,
      diwali:      /\b(diwali|lakshmi\s+puja)\b/i,
      shivratri:   /\b(shivratri|shiva|mahadev|om\s*namah)\b/i,
      janmashtami: /\b(janmashtami|krishna|gopal|radha)\b/i,
      ram_navami:  /\b(ram\s*navami|ram\s+bhajan|hanuman)\b/i,
      eid:         /\b(eid|ramadan|namaaz)\b/i,
      christmas:   /\b(christmas|christ)\b/i,
      guru_purab:  /\b(guru\s*purab|gurpurab|gurunanak|vaisakhi)\b/i,
      sawan:       /\b(sawan|shravan|kanwar)\b/i,
    },
    languages: {
      hindi:    { script: /[ऀ-ॿ]/, keyword: /\bhindi\b/i },
      sanskrit: { script: null,               keyword: /\b(sanskrit|shloka|vedic)\b/i },
      gujarati: { script: /[઀-૿]/, keyword: /\bgujarati\b/i },
      tamil:    { script: /[஀-௿]/, keyword: /\btamil\b/i },
      telugu:   { script: /[ఀ-౿]/, keyword: /\btelugu\b/i },
      marathi:  { script: null,               keyword: /\bmarathi\b/i },
      punjabi:  { script: /[਀-੿]/, keyword: /\b(punjabi|gurbani|waheguru)\b/i },
    },
  },

  entertainment: {
    opportunity: { min_lift: 1.0, max_rarity: 90, min_peer_count: 1 },
    formats: {
      sketch:            /\b(sketch|skit|scene|short\s*film)\b/i,
      reaction:          /\b(reaction|reacts?|public\s+reaction|family\s+reaction)\b/i,
      roast:             /\b(roast|troll|savage|insult|comeback)\b/i,
      prank:             /\b(prank|social\s+experiment|gone\s+wrong)\b/i,
      challenge:         /\b(challenge|try\s+not\s+to|dare|only\s+using|24\s*hours?)\b/i,
      shorts_series:     /\b(shorts?|part\s*\d+|episode\s*\d+|ep\s*\d+)\b/i,
      trailer_breakdown: /\b(trailer|teaser|breakdown|explained|details?\s+missed)\b/i,
      review:            /\b(review|honest\s+review|worth\s+watching|verdict)\b/i,
      recap:             /\b(recap|before\s+watching|story\s+so\s+far|timeline)\b/i,
      ranking:           /\b(ranking|ranked|top\s*\d+|best|worst)\b/i,
      vlog_story:        /\b(vlog|daily\s+life|day\s+in\s+my\s+life|family\s+vlog)\b/i,
      behind_scene:      /\b(behind\s+the\s+scenes|making\s+of|bts)\b/i,
    },
    moods: {
      comedy:    /\b(comedy|funny|hilarious|laugh|meme)\b/i,
      drama:     /\b(drama|emotional|heart\s*touching|sad|lesson|moral)\b/i,
      suspense:  /\b(suspense|mystery|twist|shocking|secret|truth)\b/i,
      family:    /\b(family|mom|dad|mother|father|brother|sister|parents)\b/i,
      celebrity: /\b(celebrity|actor|actress|star|bollywood|tollywood|kollywood)\b/i,
      fan:       /\b(fan|fandom|kpop|anime|marvel|dc)\b/i,
    },
    occasions: {
      release:  /\b(new\s+release|released|premiere|first\s+look|trailer\s+launch)\b/i,
      festival: /\b(diwali|holi|eid|christmas|new\s+year|navratri|festival)\b/i,
      wedding:  /\b(wedding|shaadi|sangeet|mehndi)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      bhojpuri: { script: null,               keyword: /\bbhojpuri\b/i },
      gujarati: { script: null, keyword: /\bgujarati\b/i },
      marathi:  { script: null,               keyword: /\bmarathi\b/i },
      english:  { script: null,               keyword: /\benglish\b/i },
    },
  },

  gaming: {
    opportunity: { min_lift: 0.8, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.9, combo_max_rarity: 95, combo_min_videos: 2, combo_min_channels: 1 },
    formats: {
      gameplay:      /\b(gameplay|playing|played|match|round|mission|ranked\s+match|custom\s+room)\b/i,
      challenge:     /\b(challenge|only\s+using|without|no\s+damage|one\s+life|hardcore|speedrun|rank\s+push|clutch|solo\s+vs\s+squad)\b/i,
      update:        /\b(update|new\s+update|patch|season|version|event|leak|released?|coming\s+soon|new\s+mode|new\s+map)\b/i,
      tips_guide:    /\b(tips?|tricks?|guide|tutorial|how\s+to|settings|sensitivity|best\s+settings|loadout|build|controls?|aim|crosshair)\b/i,
      comparison:    /\b(vs|versus|comparison|which\s+is\s+better|best|top\s*\d+|ranking|ranked)\b/i,
      funny_moments: /\b(funny|troll|rage|fails?|moments|reaction|meme|toxic|insane)\b/i,
      story_mission: /\b(story|mission|chapter|episode|roleplay|rp|survival|hardcore|100\s+days)\b/i,
      live_stream:   /\b(live|stream|streaming|watch\s+me)\b/i,
    },
    moods: {
      free_fire:   /\b(free\s*fire|garena)\b/i,
      bgmi:        /\b(bgmi|pubg|pubg\s+mobile|battlegrounds)\b/i,
      minecraft:   /\b(minecraft|mcpe|herobrine)\b/i,
      roblox:      /\broblox\b/i,
      gta:         /\b(gta|grand\s+theft\s+auto|gta\s*5|gta\s*6)\b/i,
      valorant:    /\b(valorant|valo)\b/i,
      competitive: /\b(rank|ranked|pro|esports|tournament|scrim|competitive)\b/i,
      beginner:    /\b(beginner|new\s+player|noob|starter|easy)\b/i,
      clutch:      /\b(clutch|comeback|last\s+zone|1v\d|solo\s+vs)\b/i,
      scary:       /\b(scary|horror|haunted|creepy)\b/i,
      survival:    /\b(survival|hardcore|100\s+days)\b/i,
    },
    occasions: {
      new_season:      /\b(new\s+season|season\s+\d+|battle\s+pass|elite\s+pass)\b/i,
      tournament:      /\b(tournament|world\s+cup|championship|finals?|scrim)\b/i,
      festival_event:  /\b(diwali|holi|eid|christmas|new\s+year|festival|anniversary\s+event)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      marathi:  { script: null, keyword: /\bmarathi\b/i },
      english:  { script: null, keyword: /\benglish\b/i },
    },
  },

  sports: {
    opportunity: { min_lift: 0.65, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.75, combo_max_rarity: 100, combo_min_videos: 2, combo_min_channels: 1 },
    formats: {
      match_update:       /\b(vs|versus|match|today\s+match|next\s+match|live\s+match|score|scorecard|result|latest\s+news|update|news)\b/i,
      match_preview:      /\b(preview|before\s+the\s+match|pre[-\s]?match|key\s+battles?|match\s+prediction|playing\s+xi)\b/i,
      post_match_analysis:/\b(post[-\s]?match|match\s+analysis|review|reaction|what\s+happened|moments?|turning\s+point)\b/i,
      player_form:        /\b(player\s+form|form\s+analysis|performance|stats?|runs?|wickets?|goals?|strike\s+rate|average)\b/i,
      tactical_breakdown: /\b(tactics?|strategy|formation|field\s+setting|bowling\s+plan|batting\s+order|game\s+plan)\b/i,
      lineup_debate:      /\b(line[-\s]?up|lineup|playing\s+xi|best\s+xi|squad|team\s+selection|should\s+.*\s+play)\b/i,
      highlights_recap:   /\b(highlights?|recap|top\s+\d+|best\s+moments?|full\s+match|scorecard)\b/i,
      ranking:            /\b(ranking|ranked|top\s*\d+|best|worst|all[-\s]?time|goat)\b/i,
      prediction:         /\b(prediction|predict|who\s+will\s+win|winner|odds|chances)\b/i,
      auction_transfer:   /\b(auction|retention|release|trade|transfer|signing|contract|draft)\b/i,
      fantasy_team:       /\b(fantasy|dream\s*11|dream11|captain|vice\s+captain|fantasy\s+team)\b/i,
      rule_explainer:     /\b(rule|rules?|explained|how\s+does|why\s+is|umpire|referee|var|lbw|drs)\b/i,
      injury_selection:   /\b(injury|injured|fitness\s+test|rested|dropped|selected|selection|comeback|return)\b/i,
    },
    moods: {
      cricket:     /\b(cricket|ipl|t20|odi|test\s+match|wicket|batting|bowling|batsman|bowler|rcb|csk|mi|srh|kkr|dc|lsg|gt)\b/i,
      football:    /\b(football|soccer|fifa|premier\s+league|la\s+liga|champions\s+league|goal|penalty|striker)\b/i,
      kabaddi:     /\b(kabaddi|pro\s+kabaddi|raid|raider|defender|tackle)\b/i,
      fantasy:     /\b(fantasy|dream\s*11|dream11|captain|vice\s+captain)\b/i,
      rivalry:     /\b(vs|versus|rivalry|derby|india\s+vs\s+pakistan|ind\s+vs\s+pak)\b/i,
      beginner:    /\b(beginner|simple|basics?|explained|new\s+fans?)\b/i,
      underdog:    /\b(underdog|comeback|upset|shock|surprise|dark\s+horse)\b/i,
    },
    occasions: {
      ipl:         /\b(ipl|indian\s+premier\s+league)\b/i,
      world_cup:   /\b(world\s+cup|wc\s+\d{4}|t20\s+world\s+cup)\b/i,
      final:       /\b(final|semi[-\s]?final|qualifier|eliminator|playoffs?)\b/i,
      auction:     /\b(auction|mega\s+auction|retention|release|trade)\b/i,
      derby:       /\b(derby|rivalry|india\s+vs\s+pakistan|ind\s+vs\s+pak|el\s+clasico)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      marathi:  { script: null, keyword: /\bmarathi\b/i },
      english:  { script: null, keyword: /\benglish\b/i },
    },
  },

  experience: {
    opportunity: { min_lift: 0.8, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.9, combo_max_rarity: 95, combo_min_videos: 2, combo_min_channels: 1 },
    formats: {
      day_in_life:    /\b(day\s+in\s+(my|the)\s+life|daily\s+vlog|full\s+day|routine)\b/i,
      itinerary:      /\b(itinerary|one\s+day\s+trip|2\s+days?|3\s+days?|weekend\s+trip|things\s+to\s+do)\b/i,
      budget:         /\b(budget|cost|expense|price|cheap|affordable|under\s+\d+|rs\.?|₹)\b/i,
      guide:          /\b(guide|tips?|before\s+you\s+go|must\s+know|how\s+to\s+reach)\b/i,
      honest_review:  /\b(honest\s+review|worth\s+it|reality|expectation|truth|what\s+nobody\s+tells)\b/i,
      hidden_gem:     /\b(hidden\s+gem|secret|unknown|less\s+crowded|offbeat)\b/i,
      journey:        /\b(journey|train|flight|airport|bus|road\s+trip|ride|drive)\b/i,
      stay_tour:      /\b(hotel|hostel|resort|room\s+tour|stay|airbnb|homestay)\b/i,
      food_walk:      /\b(street\s+food|food\s+tour|what\s+i\s+ate|local\s+food|market)\b/i,
      family_vlog:    /\b(family\s+vlog|with\s+family|mom|dad|parents|kids)\b/i,
      shopping:       /\b(shopping|haul|market|mall|bazar|bazaar)\b/i,
      village_life:   /\b(village\s+life|rural\s+life|farm\s+life|gaon|desi\s+life)\b/i,
      recipe_process: /\b(recipe|cooking|cook|made|making|kitchen|homemade|from\s+scratch)\b/i,
      taste_test:     /\b(taste\s+test|trying|tried|eating|food\s+review|best\s+food)\b/i,
      city_walk:      /\b(city\s+walk|old\s+city|walking\s+tour|explore|exploring)\b/i,
      festival_visit: /\b(festival|mela|fair|jatra|utsav|celebration)\b/i,
      comparison:     /\b(vs|versus|comparison|which\s+is\s+better|best\s+vs)\b/i,
    },
    moods: {
      solo:     /\bsolo\b|\balone\b/i,
      local:    /\blocal\b|\bvillage\b|\bold\s+city\b|\bdesi\b/i,
      luxury:   /\bluxury\b|\bpremium\b|\bexpensive\b|\b5\s*star\b/i,
      budget:   /\bbudget\b|\bcheap\b|\baffordable\b/i,
      family:   /\bfamily\b|\bparents\b|\bkids\b/i,
      first_time:/\bfirst\s+time\b|\bfirst\s+visit\b/i,
      spicy:    /\b(spicy|masala|chatpata|hot\s+food)\b/i,
      nostalgic:/\b(childhood|old\s+days|nostalgia|traditional|authentic)\b/i,
    },
    occasions: {
      weekend:  /\bweekend\b/i,
      festival: /\b(diwali|holi|eid|christmas|new\s+year|navratri|festival|mela|fair)\b/i,
      monsoon:  /\b(monsoon|rain|barish)\b/i,
      summer:   /\b(summer|vacation|holiday)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      gujarati: { script: null, keyword: /\bgujarati\b/i },
      marathi:  { script: null, keyword: /\bmarathi\b/i },
      english:  { script: null, keyword: /\benglish\b/i },
    },
  },

  education: {
    opportunity: { min_lift: 0.7, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.85, combo_max_rarity: 95, combo_min_videos: 2, combo_min_channels: 1 },
    formats: {
      concept_explainer: /\b(explain|explained|concept|basics?|introduction|what\s+is|how\s+does|chapter|lesson|lecture|topic)\b/i,
      tutorial:          /\b(tutorial|how\s+to|step\s+by\s+step|complete\s+guide|learn|training|course|class)\b/i,
      mistakes:          /\b(mistakes?|avoid|wrong|common\s+errors?|do\s+not|don't)\b/i,
      revision:          /\b(revision|revise|quick\s+revision|summary|one\s+shot|last\s+minute)\b/i,
      quiz:              /\b(quiz|mcq|questions?|test|practice|mock\s+test|solve)\b/i,
      exam_update:       /\b(exam|syllabus|cutoff|answer\s+key|admit\s+card|result|notification|dates?)\b/i,
      project:           /\b(project|assignment|practical|demo|build|case\s+study)\b/i,
      notes:             /\b(notes|pdf|cheat\s*sheet|worksheet|formula|short\s+tricks?)\b/i,
      comparison:        /\b(vs|versus|difference|compare|comparison|which\s+is\s+better)\b/i,
      doubt_solving:     /\b(doubt|doubts|q\s*&\s*a|qna|faq|live\s+class|ask)\b/i,
      facts:             /\b(facts?|did\s+you\s+know|amazing|interesting|unknown|why\s+does|science)\b/i,
      tips_tricks:        /\b(tips?|tricks?|hack|shortcut|strategy|method|technique)\b/i,
      story_learning:     /\b(history|story|biography|case\s+file|documentary|timeline)\b/i,
      skill_demo:         /\b(photoshop|premiere|after\s+effects|editing|edit|design|canva|excel|powerpoint|coding|programming|python|javascript|ai\s+tools?|chatgpt|software|app)\b/i,
      transformation:     /\b(before\s+and\s+after|transform|makeover|improve|fix|repair|remove|create|make)\b/i,
      solved_examples:    /\b(solved\s+examples?|numericals?|problems?|solutions?|worked\s+example)\b/i,
      previous_year:      /\b(previous\s+year|pyq|past\s+paper|last\s+year|question\s+paper)\b/i,
      roadmap:            /\b(roadmap|plan|schedule|timetable|strategy|how\s+to\s+prepare)\b/i,
      resource_review:    /\b(book\s+review|best\s+books?|resources?|material|playlist|course\s+review)\b/i,
      shorts_lesson:      /\b(shorts?|one\s+minute|60\s+seconds?|quick\s+learn|quick\s+lesson)\b/i,
      live_class:         /\b(live\s+class|live\s+session|marathon|session|webinar)\b/i,
      important_questions:/\b(important\s+questions?|most\s+important|expected\s+questions?|sure\s+shot)\b/i,
    },
    moods: {
      beginner: /\b(beginner|basic|zero\s+level|from\s+scratch|class\s+\d+)\b/i,
      advanced: /\b(advanced|pro|expert|masterclass|deep\s+dive)\b/i,
      exam:     /\b(upsc|ssc|jee|neet|gate|cat|ias|prelims|mains|board|cbse|icse)\b/i,
      career:   /\b(career|job|interview|resume|placement|salary)\b/i,
      language: /\b(english|grammar|vocabulary|spoken|ielts|hindi|sanskrit)\b/i,
      creative_skill: /\b(photo|video|editing|design|art|drawing|painting|music\s+lesson)\b/i,
      tech_skill: /\b(coding|programming|computer|software|ai|excel|data|web\s+dev)\b/i,
    },
    occasions: {
      exam_season: /\b(exam\s+season|before\s+exam|prelims|mains|board\s+exam|final\s+exam)\b/i,
      new_batch:   /\b(new\s+batch|batch\s+start|course\s+start|admission)\b/i,
      result_day:  /\b(result|answer\s+key|cutoff|rank|scorecard)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      english:  { script: null, keyword: /\benglish\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      marathi:  { script: null, keyword: /\bmarathi\b/i },
    },
  },

  wellness: {
    opportunity: { min_lift: 0.75, max_rarity: 100, min_peer_count: 1, combo_min_lift: 0.9, combo_max_rarity: 90, combo_min_videos: 3, combo_min_channels: 2 },
    formats: {
      routine_test:  /\b(7\s*days?|14\s*days?|30\s*days?|routine|challenge|transformation|before\s+and\s+after)\b/i,
      mistakes:      /\b(mistakes?|avoid|wrong|common\s+errors?|stop\s+doing|myths?)\b/i,
      beginner_plan: /\b(beginner|start|starting|first\s+week|basics?|guide|plan)\b/i,
      form_fix:      /\b(form|technique|correct|fix|posture|exercise\s+tips?)\b/i,
      full_day:      /\b(full\s+day|what\s+i\s+eat|diet|meal|workout\s+day|day\s+in\s+life)\b/i,
      myth_busting:  /\b(myth|truth|science|facts?|explained|doctor\s+explains)\b/i,
      recovery:      /\b(recovery|sleep|stress|mobility|stretch|rest|pain|injury)\b/i,
      mindset:       /\b(mindset|motivation|discipline|habit|productivity|focus|confidence)\b/i,
      diet_plan:     /\b(diet\s+plan|meal\s+plan|calories?|protein|nutrition|what\s+i\s+eat)\b/i,
      follow_along:  /\b(follow\s+along|with\s+me|workout\s+with\s+me|guided)\b/i,
      doctor_advice: /\b(doctor|medical|medicine|symptoms?|treatment|health\s+tips?)\b/i,
      meditation:    /\b(meditation|mindfulness|breathing|relaxation|sleep|calm)\b/i,
      exercise_demo: /\b(push\s*ups?|squats?|plank|abs|cardio|yoga\s+pose|asana|stretching|walking)\b/i,
      remedy:        /\b(remedy|home\s+remedy|natural|ayurvedic|nuskha|tips?)\b/i,
      shorts_tip:    /\b(shorts?|quick\s+tip|one\s+minute|60\s+seconds?|daily\s+tip)\b/i,
      test_result:   /\b(test|blood\s+test|report|result|checkup|screening|diagnosis)\b/i,
      condition_guide:/\b(diabetes|thyroid|bp|blood\s+pressure|pcos|cholesterol|vitamin|hair\s+fall|skin|acne|back\s+pain|knee\s+pain)\b/i,
      yoga_flow:     /\b(yoga|pranayama|surya\s+namaskar|flow|asana|pose)\b/i,
      supplement:    /\b(supplement|whey|creatine|vitamin|minerals?|omega|tablet)\b/i,
      transformation_story: /\b(journey|story|lost\s+\d+|gained\s+\d+|transformed|my\s+body)\b/i,
    },
    moods: {
      beginner:      /\b(beginner|new|first\s+time|zero\s+level)\b/i,
      fat_loss:      /\b(weight\s+loss|fat\s+loss|belly\s+fat|lose\s+weight|cutting)\b/i,
      muscle_gain:   /\b(muscle|bodybuilding|bulk|strength|hypertrophy|gym)\b/i,
      home_fitness:  /\b(home\s+workout|no\s+equipment|bodyweight|calisthenics)\b/i,
      mental_health: /\b(mental\s+health|anxiety|stress|adhd|depression|therapy|overthinking)\b/i,
      habit_change:  /\b(habit|routine|discipline|consistency|dopamine|focus)\b/i,
      womens_health: /\b(women|female|pcos|periods?|pregnancy|postpartum|hormones?)\b/i,
      senior_health: /\b(senior|elderly|after\s+40|after\s+50|joint|knee|back\s+pain)\b/i,
      natural_care:  /\b(natural|ayurveda|home\s+remedy|herbal|desi|nuskha)\b/i,
    },
    occasions: {
      summer:      /\b(summer|vacation|wedding\s+season)\b/i,
      new_year:    /\b(new\s+year|resolution|reset)\b/i,
      exam_stress: /\b(exam\s+stress|study\s+stress|burnout)\b/i,
    },
    languages: {
      hindi:    { script: null, keyword: /\bhindi\b/i },
      english:  { script: null, keyword: /\benglish\b/i },
      tamil:    { script: null, keyword: /\btamil\b/i },
      telugu:   { script: null, keyword: /\btelugu\b/i },
      kannada:  { script: null, keyword: /\bkannada\b/i },
      malayalam:{ script: null, keyword: /\bmalayalam\b/i },
      bengali:  { script: null, keyword: /\bbengali\b/i },
      marathi:  { script: null, keyword: /\bmarathi\b/i },
    },
  },
};

// ── Human-readable axis value labels ─────────────────────────────────────────
const AXIS_LABELS = {
  cover: 'cover version', acoustic: 'acoustic/unplugged', lyric_video: 'lyric video',
  live_session: 'live session', mashup: 'mashup', reprise: 'reprise',
  slowed_reverb: 'slowed/reverb', instrumental: 'instrumental',
  behind_song: 'behind-the-song', medley: 'medley/jukebox',
  original: 'original song', hook_clip: 'hook clip',
  remix: 'remix', dj_mix: 'DJ mix', status_edit: 'status/reel edit',
  karaoke: 'karaoke/backing track', ringtone: 'ringtone',
  studio_version: 'studio/audio version', performance: 'performance clip',
  music_video: 'music video', lyrical_status: 'lyrical/status video',
  bhajan: 'bhajan', aarti: 'aarti', mantra: 'mantra/chant', kirtan: 'kirtan',
  stotra: 'stotra/chalisa', katha: 'katha/pravachan', guided: 'guided meditation',
  live_darshan: 'live darshan', devotional_loop: 'devotional loop',
  paath: 'paath/recitation', shabad: 'shabad/gurbani', qawwali: 'qawwali/naat',
  gospel: 'gospel/worship', ringtone: 'ringtone/status',
  sketch: 'sketch/skit', reaction: 'reaction', roast: 'roast/troll',
  prank: 'prank/social experiment', challenge: 'challenge', shorts_series: 'short series',
  trailer_breakdown: 'trailer breakdown', review: 'review/verdict', recap: 'recap',
  ranking: 'ranking/list', vlog_story: 'vlog story', behind_scene: 'behind-the-scenes',
  gameplay: 'gameplay', update: 'update breakdown', tips_guide: 'tips/settings guide',
  funny_moments: 'funny moments', story_mission: 'story/mission', live_stream: 'live stream',
  match_preview: 'match preview', post_match_analysis: 'post-match analysis',
  match_update: 'match update',
  player_form: 'player form breakdown', tactical_breakdown: 'tactical breakdown',
  lineup_debate: 'lineup debate', highlights_recap: 'highlights recap',
  prediction: 'prediction', auction_transfer: 'auction/transfer update',
  fantasy_team: 'fantasy team', rule_explainer: 'rule explainer',
  injury_selection: 'injury/selection update',
  day_in_life: 'day-in-life', itinerary: 'itinerary', budget: 'budget breakdown',
  guide: 'guide/tips', honest_review: 'honest review', hidden_gem: 'hidden gem',
  journey: 'journey/travel', stay_tour: 'stay/room tour', food_walk: 'food walk',
  family_vlog: 'family vlog', shopping: 'shopping/market',
  village_life: 'village life', recipe_process: 'recipe/process', taste_test: 'taste test',
  city_walk: 'city walk', festival_visit: 'festival visit',
  concept_explainer: 'concept explainer', tutorial: 'tutorial', mistakes: 'mistake-led lesson',
  revision: 'revision', quiz: 'quiz/practice', exam_update: 'exam update',
  project: 'project/demo', notes: 'notes/checklist', comparison: 'comparison',
  doubt_solving: 'doubt-solving', beginner: 'beginner', advanced: 'advanced',
  facts: 'facts/curiosity', tips_tricks: 'tips/tricks', story_learning: 'story-led learning',
  skill_demo: 'skill demo', transformation: 'before/after fix',
  solved_examples: 'solved examples', previous_year: 'previous-year questions',
  roadmap: 'roadmap/plan', resource_review: 'resource review',
  shorts_lesson: 'short lesson', live_class: 'live class',
  important_questions: 'important questions',
  routine_test: 'routine test', beginner_plan: 'beginner plan', form_fix: 'form fix',
  full_day: 'full day breakdown', myth_busting: 'myth busting', recovery: 'recovery',
  mindset: 'mindset', fat_loss: 'fat loss', muscle_gain: 'muscle gain',
  home_fitness: 'home fitness', mental_health: 'mental health', habit_change: 'habit change',
  diet_plan: 'diet plan', follow_along: 'follow-along',
  doctor_advice: 'doctor advice', meditation: 'meditation/relaxation',
  exercise_demo: 'exercise demo', remedy: 'remedy/tips',
  shorts_tip: 'short tip', test_result: 'test/report result',
  condition_guide: 'condition guide', yoga_flow: 'yoga flow',
  supplement: 'supplement guide', transformation_story: 'transformation story',
  womens_health: 'women’s health', senior_health: 'senior/joint health',
  natural_care: 'natural care',
  exam: 'exam prep', career: 'career', language: 'language learning',
  creative_skill: 'creative skill', tech_skill: 'tech skill',
  exam_season: 'exam season', new_batch: 'new batch', result_day: 'result day',
  romantic: 'romantic', heartbreak: 'heartbreak/sad', devotional: 'devotional',
  party: 'party/dance', lofi: 'lo-fi/chill', nostalgia: 'nostalgic/classic',
  high_energy: 'high-energy', dance: 'dance', folk: 'folk/traditional',
  regional: 'regional language',
  morning: 'morning prayer', sleep_calm: 'sleep/calm', protection: 'protection prayer',
  shiva: 'Shiva/Mahadev', krishna: 'Krishna/Radha', ram: 'Ram/Hanuman',
  devi: 'Devi/Mata', sai: 'Sai Baba',
  comedy: 'comedy', drama: 'emotional drama', suspense: 'suspense/twist',
  family: 'family', celebrity: 'celebrity', fan: 'fan/fandom',
  free_fire: 'Free Fire', bgmi: 'BGMI/PUBG', minecraft: 'Minecraft',
  roblox: 'Roblox', gta: 'GTA', valorant: 'Valorant',
  clutch: 'clutch comeback', scary: 'scary/horror', survival: 'survival',
  competitive: 'competitive/ranked',
  cricket: 'cricket', football: 'football', kabaddi: 'kabaddi',
  fantasy: 'fantasy sports', rivalry: 'rivalry', underdog: 'underdog',
  spicy: 'spicy food', nostalgic: 'nostalgic/traditional',
  wedding: 'wedding season', festival: 'festival season', valentine: 'Valentine week',
  monsoon: 'monsoon season', farewell: 'farewell/graduation', release: 'new release',
  navratri: 'Navratri', diwali: 'Diwali', shivratri: 'Maha Shivratri',
  janmashtami: 'Janmashtami', ram_navami: 'Ram Navami', eid: 'Eid', christmas: 'Christmas',
  guru_purab: 'Guru Purab', sawan: 'Sawan/Shravan',
  new_season: 'new season', tournament: 'tournament', festival_event: 'festival event',
  ipl: 'IPL', world_cup: 'World Cup', final: 'final/playoff', auction: 'auction',
  derby: 'rivalry match',
  hindi: 'Hindi', punjabi: 'Punjabi', tamil: 'Tamil', telugu: 'Telugu',
  gujarati: 'Gujarati', marathi: 'Marathi', bengali: 'Bengali', bhojpuri: 'Bhojpuri',
  urdu: 'Urdu', english: 'English', sanskrit: 'Sanskrit', kannada: 'Kannada',
  malayalam: 'Malayalam',
};

function _fmtV(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

// ── Language detection ────────────────────────────────────────────────────────
// Keyword takes priority over script to handle shared-script cases (Hindi/Marathi).
function detectLanguages(title, langConfig) {
  const detected = [];
  for (const [lang, { script, keyword }] of Object.entries(langConfig)) {
    if (keyword && keyword.test(title)) { detected.push(lang); continue; }
    if (script && script.test(title) && !detected.includes(lang)) detected.push(lang);
  }
  return detected;
}

// ── Classify a single video title against a family config ────────────────────
function classifyTitle(title, familyConfig) {
  const result = { formats: [], occasions: [], languages: [] };
  if (familyConfig.moods) result.moods = [];

  for (const [key, re] of Object.entries(familyConfig.formats || {})) {
    if (re.test(title)) result.formats.push(key);
  }
  for (const [key, re] of Object.entries(familyConfig.moods || {})) {
    if (re.test(title)) result.moods.push(key);
  }
  for (const [key, re] of Object.entries(familyConfig.occasions || {})) {
    if (re.test(title)) result.occasions.push(key);
  }
  result.languages = detectLanguages(title, familyConfig.languages || {});
  return result;
}

// ── Build per-axis stats from peer videos ────────────────────────────────────
function emptyFormatEvidence() {
  return {
    short_form_videos: 0,
    likely_short_form_videos: 0,
    long_form_videos: 0,
    unknown_videos: 0,
    short_form_views: 0,
    long_form_views: 0,
  };
}

function addFormatEvidence(evidence, video = {}) {
  let type = video.format_type || 'unknown';
  if (type === 'unknown' || !type) {
    const dur = video.duration_seconds || 0;
    if (dur > 0 && dur <= 60) type = 'short_form';
    else if (dur > 180) type = 'long_form';
  }
  const views = video.views || 0;
  if (type === 'short_form') {
    evidence.short_form_videos++;
    evidence.short_form_views += views;
  } else if (type === 'likely_short_form') {
    evidence.likely_short_form_videos++;
    evidence.short_form_views += views;
  } else if (type === 'long_form') {
    evidence.long_form_videos++;
    evidence.long_form_views += views;
  } else {
    evidence.unknown_videos++;
  }
}

function summarizeFormatEvidence(evidence = {}) {
  const shortCount = (evidence.short_form_videos || 0) + (evidence.likely_short_form_videos || 0);
  const longCount = evidence.long_form_videos || 0;
  const total = shortCount + longCount + (evidence.unknown_videos || 0);
  const evidenceType = longCount >= 2 && shortCount >= 2 ? 'mixed_signal'
    : longCount >= 2 ? 'long_form_backed'
    : shortCount >= 2 ? 'short_form_spark'
    : 'thin_format_signal';
  return {
    evidence_type: evidenceType,
    short_form_videos: shortCount,
    long_form_videos: longCount,
    unknown_videos: evidence.unknown_videos || 0,
    short_form_pct: total ? Math.round(shortCount / total * 100) : 0,
    long_form_pct: total ? Math.round(longCount / total * 100) : 0,
    short_form_views: evidence.short_form_views || 0,
    long_form_views: evidence.long_form_views || 0,
  };
}
function buildAxisMap(peerVideos, familyKey) {
  const config = FAMILY_CONFIG[familyKey];
  if (!config) return { axisMap: new Map(), baselineAvg: 0, totalVideos: 0 };

  const axisMap = new Map();
  let totalViews = 0;

  function record(axis, value, video) {
    const key = `${axis}:${value}`;
    if (!axisMap.has(key)) {
      axisMap.set(key, { axis, value, videos: 0, total_views: 0, channel_ids: new Set(), format_evidence: emptyFormatEvidence(), sample_titles: [] });
    }
    const b = axisMap.get(key);
    b.videos++;
    b.total_views += (video.views || 0);
    b.channel_ids.add(video.channel_id);
    addFormatEvidence(b.format_evidence, video);
    // Capture titles for format axis only — used later to replace label-only topics
    if (axis === 'format' && video.title) {
      b.sample_titles.push({ title: video.title, views: video.views || 0 });
    }
  }

  for (const video of peerVideos) {
    totalViews += (video.views || 0);
    const cls = classifyTitle(video.title || '', config);
    for (const f of cls.formats)           record('format',   f, video);
    for (const m of (cls.moods || []))     record('mood',     m, video);
    for (const o of cls.occasions)         record('occasion', o, video);
    for (const l of cls.languages)         record('language', l, video);
  }

  const totalVideos  = peerVideos.length;
  const baselineAvg  = totalVideos > 0 ? totalViews / totalVideos : 0;

  for (const b of axisMap.values()) {
    b.avg_views  = b.videos > 0 ? Math.round(b.total_views / b.videos) : 0;
    b.lift_ratio = baselineAvg > 0 ? parseFloat((b.avg_views / baselineAvg).toFixed(2)) : 1.0;
    b.rarity_pct = totalVideos > 0 ? Math.round((b.videos / totalVideos) * 100) : 0;
    b.peer_count = b.channel_ids.size;
    if (b.sample_titles && b.sample_titles.length > 1) {
      b.sample_titles.sort((a, c) => c.views - a.views);
      b.sample_titles = b.sample_titles.slice(0, 5);
    }
  }

  return { axisMap, baselineAvg, totalVideos };
}

// ── Score single-axis opportunities ─────────────────────────────────────────
function scoreSingleAxes(axisMap, minPeerCount, familyKey) {
  const cfg = FAMILY_CONFIG[familyKey]?.opportunity || {};
  const minLift = cfg.min_lift ?? 1.15;
  const maxRarity = cfg.max_rarity ?? 65;
  const minPeers = Math.min(minPeerCount, cfg.min_peer_count ?? minPeerCount);
  const opps = [];
  for (const b of axisMap.values()) {
    // Language should modify a format/mood, not become a raw standalone idea.
    if (b.axis === 'language') continue;
    if (b.peer_count < minPeers) continue;
    if (b.lift_ratio < minLift) continue;
    if (b.rarity_pct > maxRarity) continue;

    const evidence = {
      peer_video_count: b.videos,
      channel_count:    b.peer_count,
      avg_views:        b.avg_views,
      lift_ratio:       b.lift_ratio,
      rarity_pct:       b.rarity_pct,
      format_evidence:  summarizeFormatEvidence(b.format_evidence),
    };
    const rawScore = Math.round(
      (b.lift_ratio - 1) * 40 +
      Math.max(0, 40 - b.rarity_pct) * 0.5 +
      Math.min(10, b.peer_count * 1.5),
    );
    const score = applyEvidenceAdjustment(rawScore, evidence, familyKey);

    opps.push({
      type:          'single_axis',
      axis:          b.axis,
      value:         b.value,
      score,
      evidence,
      sample_titles: b.sample_titles || [],
    });
  }
  return opps.sort((a, b) => b.score - a.score);
}

// ── Score combination (2-axis) opportunities ─────────────────────────────────
// Minimum evidence gate: peer_video_count >= 5 AND channel_count >= 3.
// Only pairs across different axes (format+mood, format+language, etc.).
function scoreCombinations(peerVideos, familyKey, baselineAvg) {
  const config = FAMILY_CONFIG[familyKey];
  if (!config) return [];

  const combMap = new Map();

  for (const video of peerVideos) {
    const cls = classifyTitle(video.title || '', config);
    const axes = [
      ...cls.formats.map(v => ({ axis: 'format',   value: v })),
      ...(cls.moods || []).map(v => ({ axis: 'mood', value: v })),
      ...cls.occasions.map(v => ({ axis: 'occasion', value: v })),
      ...cls.languages.map(v => ({ axis: 'language', value: v })),
    ];

    for (let i = 0; i < axes.length; i++) {
      for (let j = i + 1; j < axes.length; j++) {
        if (axes[i].axis === axes[j].axis) continue;
        if (
          (axes[i].axis === 'language' || axes[j].axis === 'language') &&
          ![axes[i].axis, axes[j].axis].some(axis => axis === 'format' || axis === 'mood')
        ) {
          continue;
        }
        const key = [axes[i].axis + ':' + axes[i].value, axes[j].axis + ':' + axes[j].value].sort().join('||');
        if (!combMap.has(key)) {
          combMap.set(key, { axes: [axes[i], axes[j]], videos: 0, total_views: 0, channel_ids: new Set(), format_evidence: emptyFormatEvidence() });
        }
        const b = combMap.get(key);
        b.videos++;
        b.total_views += (video.views || 0);
        b.channel_ids.add(video.channel_id);
        addFormatEvidence(b.format_evidence, video);
      }
    }
  }

  const totalVideos = peerVideos.length;
  const results = [];

  for (const b of combMap.values()) {
    const cfg = FAMILY_CONFIG[familyKey]?.opportunity || {};
    const minVideos = cfg.combo_min_videos ?? 5;
    const minChannels = cfg.combo_min_channels ?? 3;
    const minLift = cfg.combo_min_lift ?? 1.2;
    const maxRarity = cfg.combo_max_rarity ?? 50;

    if (b.videos < minVideos || b.channel_ids.size < minChannels) continue;
    const avg_views  = Math.round(b.total_views / b.videos);
    const lift_ratio = baselineAvg > 0 ? parseFloat((avg_views / baselineAvg).toFixed(2)) : 1.0;
    if (lift_ratio < minLift) continue;
    const rarity_pct = totalVideos > 0 ? Math.round((b.videos / totalVideos) * 100) : 100;
    if (rarity_pct > maxRarity) continue;

    const evidence = {
      peer_video_count: b.videos,
      channel_count:    b.channel_ids.size,
      avg_views,
      lift_ratio,
      rarity_pct,
      format_evidence: summarizeFormatEvidence(b.format_evidence),
    };
    const rawScore = Math.round(
      (lift_ratio - 1) * 50 +
      Math.max(0, 50 - rarity_pct) * 0.4 +
      Math.min(15, b.channel_ids.size * 2),
    );
    const score = applyEvidenceAdjustment(rawScore, evidence, familyKey);

    results.push({
      type:     'combination',
      axes:     b.axes,
      score,
      evidence,
    });
  }

  return results.sort((a, b) => b.score - a.score);
}

// ── Build suggestion text ────────────────────────────────────────────────────
function applyEvidenceAdjustment(score, evidence, familyKey) {
  if (!evidence) return score;
  // Strong-evidence opportunities were uncapped (cap=999), so lift-driven raw scores reached
  // 130–215 — an incompatible scale that dominated the merged WTP ranking over the capped
  // peer_video_signal (<=95) and DNA bets (<=72). Bound strong evidence onto the shared scale:
  // soft-saturate above 90 into [90,95] so genuinely higher-lift opportunities still order
  // above lower-lift ones, without a raw peer score reaching 200+. Weak-evidence caps unchanged.
  const STRONG_CAP = 90;
  let cap = STRONG_CAP;
  let hardClamp = false;
  if ((evidence.channel_count ?? 0) <= 1 && (evidence.peer_video_count ?? 0) <= 1) {
    cap = 45; hardClamp = true;
  } else if ((evidence.channel_count ?? 0) <= 1) {
    cap = 58; hardClamp = true;
  } else if ((evidence.peer_video_count ?? 0) <= 2) {
    cap = 68; hardClamp = true;
  }

  let adjusted = hardClamp
    ? Math.min(score, cap)
    : (score <= cap ? score : cap + Math.min(5, (score - cap) * 0.05));
  const hasTinyEvidence = (evidence.channel_count ?? 0) <= 1 || (evidence.peer_video_count ?? 0) <= 1;
  if (hasTinyEvidence) {
    const penalty = familyKey === 'music' ? 30 : familyKey === 'education' ? 20 : 10;
    adjusted -= penalty;
  }
  return Math.max(1, Math.round(adjusted));
}

function hasTinyEvidence(opp) {
  const ev = opp?.evidence || {};
  return (ev.channel_count ?? 0) <= 1 || (ev.peer_video_count ?? 0) <= 1;
}

function prioritizeTopEvidence(opps, familyKey) {
  if (familyKey !== 'music' && familyKey !== 'education') return opps;
  const stronger = opps.filter(opp => !hasTinyEvidence(opp));
  if (stronger.length < 3) return opps;
  const tiny = opps.filter(hasTinyEvidence);
  return [...stronger, ...tiny];
}

function prioritizeOutputTopEvidence(ideas, familyKey) {
  if (familyKey !== 'music' && familyKey !== 'education') return ideas;
  const stronger = ideas.filter(idea => !hasTinyEvidence(idea));
  if (stronger.length < 3) return ideas;
  const tiny = ideas.filter(hasTinyEvidence);
  return [...stronger, ...tiny];
}

function labelFor(value) {
  return AXIS_LABELS[value] || value;
}

function familyNoun(familyKey) {
  switch (familyKey) {
    case 'music':         return 'music format';
    case 'devotional':    return 'devotional format';
    case 'gaming':        return 'gaming format';
    case 'sports':        return 'sports analysis format';
    case 'experience':    return 'food/travel format';
    case 'education':     return 'lesson format';
    case 'wellness':      return 'health/wellness format';
    case 'entertainment': return 'story/reaction format';
    default:              return 'repeatable format';
  }
}

function articleFor(text) {
  return /^[aeiou]/i.test(String(text || '').trim()) ? 'an' : 'a';
}

function commandForFormatLabel(label) {
  const clean = String(label || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Make a repeatable video with a clear payoff';
  if (/\b(video|stream|session|class|clip|guide|tutorial|breakdown|review|recap|ranking|story|lesson)\b/i.test(clean)) {
    return `Make ${articleFor(clean)} ${clean} with a clear payoff`;
  }
  return `Make ${articleFor(clean)} ${clean} video with a clear payoff`;
}

function labelWithVideoNoun(label) {
  const clean = String(label || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'video';
  if (/\b(video|stream|session|class|clip|guide|tutorial|breakdown|review|recap|ranking|story|lesson)\b/i.test(clean)) {
    return clean;
  }
  return `${clean} video`;
}

function commandForFormatMood(fmt, mood) {
  const fmtLabel = labelFor(fmt.value);
  const moodLabel = labelFor(mood.value);

  if (fmt.value === 'exam_update' && mood.value === 'exam') {
    return 'Make an exam update video with a clear payoff';
  }
  if (fmt.value === 'shorts_series' && mood.value === 'drama') {
    return 'Make an emotional short-series story with a clear payoff';
  }
  if (fmt.value === 'shorts_series') {
    return `Make ${articleFor(moodLabel)} ${moodLabel} short-series story with a clear payoff`;
  }
  if (fmtLabel.toLowerCase().includes(moodLabel.toLowerCase())) {
    return commandForFormatLabel(fmtLabel);
  }
  return commandForFormatLabel(`${moodLabel} ${fmtLabel}`);
}

function commandForSingleAxis(axis, value, familyKey) {
  const label = labelFor(value);

  if (axis === 'language') {
    return `Try a ${label}-language version of your strongest repeatable format`;
  }
  if (familyKey === 'gaming') {
    const gamingCommands = {
      gameplay: 'Turn one full match into a decision-by-decision gameplay breakdown',
      challenge: 'Create a challenge run with one clear rule and a visible payoff',
      update: 'Break down the latest game update and what players should do next',
      tips_guide: 'Make a practical settings, sensitivity, or loadout guide',
      comparison: 'Compare two choices and give a clear winner for players',
      funny_moments: 'Package funny moments around one clean setup and payoff',
      story_mission: 'Build a story or mission episode with a clear objective',
      live_stream: 'Turn a live session into a planned ranked push or challenge',
      free_fire: 'Make a Free Fire-specific version of your strongest gaming format',
      bgmi: 'Make a BGMI/PUBG-specific version of your strongest gaming format',
      minecraft: 'Make a Minecraft challenge, survival, or story episode',
      roblox: 'Make a Roblox challenge or roleplay episode with one clear goal',
      gta: 'Make a GTA mission, roleplay, or update breakdown',
      valorant: 'Make a Valorant settings, clutch, or ranked improvement guide',
      competitive: 'Build the video around a ranked or competitive improvement promise',
      beginner: 'Teach beginners one mistake and one fix they can use immediately',
      clutch: 'Build the episode around one clutch comeback and explain the decisions',
      scary: 'Turn the gameplay into a scary/horror story with a payoff',
      survival: 'Create a survival challenge with progress checkpoints',
      new_season: 'Explain what changed in the new season and what to try first',
      tournament: 'Preview or recap the tournament through key battles and mistakes',
      festival_event: 'Make an event-specific gameplay guide before the event ends',
    };
    if (gamingCommands[value]) return gamingCommands[value];
  }
  if (familyKey === 'sports') {
    const sportsCommands = {
      match_update: 'Turn the match update into what changed and what fans should watch next',
      match_preview: 'Preview the match through three key battles that can decide it',
      post_match_analysis: 'Break down the three moments that changed the match',
      player_form: 'Analyze one player\'s form and what has changed recently',
      tactical_breakdown: 'Explain the tactic or matchup most fans are missing',
      lineup_debate: 'Build a lineup debate with a clear final XI or selection call',
      highlights_recap: 'Turn the highlights into a clear story of how the match shifted',
      ranking: 'Create a ranked list with clear criteria and one debatable pick',
      prediction: 'Make a prediction with evidence, risk, and one bold call',
      auction_transfer: 'Explain the auction or transfer move and who benefits most',
      fantasy_team: 'Build a fantasy team with captain, vice-captain, and risk picks',
      rule_explainer: 'Explain one confusing rule with match examples',
      injury_selection: 'Explain the injury or selection news and how it changes the team',
      cricket: 'Make a cricket-specific analysis with one clear takeaway',
      football: 'Make a football tactical or player-form breakdown',
      kabaddi: 'Make a kabaddi key-raider or defensive matchup breakdown',
      fantasy: 'Turn the topic into a fantasy sports decision guide',
      rivalry: 'Frame the video around the rivalry and the matchup that matters most',
      beginner: 'Explain the sport topic simply for newer fans',
      underdog: 'Build the story around the underdog path to an upset',
      ipl: 'Make an IPL-specific preview, lineup, or post-match breakdown',
      world_cup: 'Make a World Cup-specific preview or tournament storyline',
      final: 'Frame the final around pressure moments and key player matchups',
      auction: 'Decode auction strategy: needs, budget, and risky buys',
      derby: 'Build the video around the rivalry and what makes this match different',
    };
    if (sportsCommands[value]) return sportsCommands[value];
  }
  if (value === 'summer') {
    return 'Make a summer-specific version of your food/travel format';
  }
  if (value === 'condition_guide') {
    return 'Create a simple guide around one specific health condition';
  }
  if (axis === 'occasion') {
    return `Make a ${label}-specific version of your ${familyNoun(familyKey)}`;
  }
  if (axis === 'mood') {
    return `Build your next ${familyNoun(familyKey)} around ${articleFor(label)} ${label} angle`;
  }
  return commandForFormatLabel(label);
}

function commandForCombination(axes, familyKey) {
  const lang = axes.find(a => a.axis === 'language');
  const fmt  = axes.find(a => a.axis === 'format');
  const mood = axes.find(a => a.axis === 'mood');
  const occ  = axes.find(a => a.axis === 'occasion');
  const packageAxis = fmt || mood;

  if (lang && packageAxis) {
    return `Try a ${labelFor(lang.value)}-language ${labelFor(packageAxis.value)} format`;
  }
  if (lang && occ) {
    return `Make a ${labelFor(lang.value)}-language version for ${labelFor(occ.value)}`;
  }
  if (occ && packageAxis) {
    return `Make a ${labelFor(occ.value)}-specific ${labelWithVideoNoun(labelFor(packageAxis.value))}`;
  }
  if (fmt && mood) {
    return commandForFormatMood(fmt, mood);
  }
  if (packageAxis) {
    return commandForSingleAxis(packageAxis.axis, packageAxis.value, familyKey);
  }
  return `Combine ${axes.map(a => labelFor(a.value)).join(' + ')} in one video`;
}

function buildSuggestion(opp, familyKey) {
  const ev = opp.evidence;
  const evidenceText = ev
    ? `${ev.channel_count} peer channel${ev.channel_count !== 1 ? 's' : ''} average ${_fmtV(ev.avg_views)} views on this — ${ev.lift_ratio.toFixed(1)}× your community baseline, used by only ${ev.rarity_pct}% of peers.`
    : null;

  if (opp.type === 'combination') {
    const langAxis = opp.axes.find(a => a.axis === 'language');
    const fmtAxis  = opp.axes.find(a => a.axis === 'format' || a.axis === 'mood');
    const occAxis  = opp.axes.find(a => a.axis === 'occasion');

    let title = '';
    if (langAxis && fmtAxis && occAxis) {
      title = `${AXIS_LABELS[langAxis.value] || langAxis.value} ${AXIS_LABELS[occAxis.value] || occAxis.value} ${AXIS_LABELS[fmtAxis.value] || fmtAxis.value}`;
    } else if (langAxis && fmtAxis) {
      title = `${AXIS_LABELS[langAxis.value] || langAxis.value} ${AXIS_LABELS[fmtAxis.value] || fmtAxis.value}`;
    } else {
      title = opp.axes.map(a => AXIS_LABELS[a.value] || a.value).join(' + ');
    }

    const suggestion = `Create a ${title.toLowerCase()} — lead with a strong opening hook and lean fully into the format.${evidenceText ? ' Evidence: ' + evidenceText : ''}`;
    return { title: title.charAt(0).toUpperCase() + title.slice(1), suggestion };
  }

  const label   = AXIS_LABELS[opp.value] || opp.value;
  const axisCtx = opp.axis === 'language' ? `${label}-language content`
                : opp.axis === 'occasion' ? `content timed to ${label}`
                : `${label} format`;
  const title      = `${label.charAt(0).toUpperCase() + label.slice(1)} opportunity`;
  const verb = ev && ev.lift_ratio >= 1.15
    ? 'it outperforms your community baseline'
    : 'it is active in your peer set and can be packaged into a repeatable format';
  const suggestion = `Try ${axisCtx} — ${verb}.${evidenceText ? ' Evidence: ' + evidenceText : ''}`;
  return { title, suggestion };
}

// ── Determine which creative family to use ───────────────────────────────────
function buildSuggestionV2(opp, familyKey) {
  const ev = opp.evidence;
  const evidenceText = ev
    ? `${ev.channel_count} peer channel${ev.channel_count !== 1 ? 's' : ''} average ${_fmtV(ev.avg_views)} views on this - ${ev.lift_ratio.toFixed(1)}x your community baseline, used by only ${ev.rarity_pct}% of peers.`
    : null;

  if (opp.type === 'combination') {
    const title = commandForCombination(opp.axes, familyKey);
    const suggestion = `${title}. Package it as a concrete episode or short, with the format visible in the first 5 seconds.${evidenceText ? ' Evidence: ' + evidenceText : ''}`;
    return { title, suggestion };
  }

  const title = commandForSingleAxis(opp.axis, opp.value, familyKey);
  const verb = ev && ev.lift_ratio >= 1.15
    ? 'it outperforms your community baseline'
    : 'it is active in your peer set and can be packaged into a repeatable format';
  const suggestion = `${title}. Use one specific example so it feels like a video idea, not a broad content bucket; ${verb}.${evidenceText ? ' Evidence: ' + evidenceText : ''}`;
  return { title, suggestion };
}

function detectFamily(niche) {
  const n = (niche || '').toLowerCase();

  const educationStrong = /\b(education|educational|learning|learn|tutorial|course|class|classes|teacher|school|college|exam|study|studies|upsc|ssc|jee|neet|gate|cat|quiz|gk|general knowledge|spoken english|grammar|vocabulary|computer basics|coding|programming|math|science lessons?|photoshop|editing tutorial|excel|ai tools?)\b/.test(n);
  const wellnessStrong = /\b(health|fitness|workout|gym|bodybuilding|calisthenics|weight\s+loss|fat\s+loss|belly\s+fat|diet|nutrition|doctor|medical|medicine|ayurveda|wellness|selfimprovement|self\s+improvement|motivation|mindset|psychology|mental\s+health|adhd|habit|productivity|yoga|mindfulness|relaxation|breathing)\b/.test(n);
  const devotionalStrong = /\b(devotional|bhakti|bhajan|chalisa|mantra|aarti|kirtan|satsang|quran|nasheed|islamic prayers?|islamic recitations?|paath|shabad|gurbani|waheguru|qawwali|naat|hamd|dua|zikr|dhikr|gospel|worship|pravachan|katha|darshan|mandir|temple|mahadev|krishna|radha|hanuman|durga|sai baba)\b/.test(n);
  const musicStrong = /\b(music|song|songs|singer|rap|hip hop|hip-hop|guitar|piano|vocals|cover song|album|lofi|lo-fi|sufi|bhojpuri songs?|punjabi songs?|hindi songs?|telugu movie songs?|bollywood songs?|music edits?|song status)\b/.test(n);
  const gamingStrong = /\b(gaming|gameplay|gamer|free\s*fire|bgmi|pubg|minecraft|roblox|valorant|gta|grand theft auto|esports|codm|call of duty|fortnite|clash royale|brawl stars|rank push|custom room)\b/.test(n);
  const sportsStrong = /\b(sports?|cricket|football|ipl|kabaddi|tournament|match highlights?|player analysis|world cup|league|championship|wicket|batting|bowling)\b/.test(n);

  // Stored niche/title text can be noisy. Do not let broad words like
  // "spiritual", "meditation", or a channel name containing "melody" override
  // explicit education/health intent.
  if (sportsStrong) {
    return 'sports';
  }
  if (educationStrong && !devotionalStrong && !musicStrong) {
    return 'education';
  }
  if (wellnessStrong && !devotionalStrong && !musicStrong) {
    return 'wellness';
  }
  if (devotionalStrong || (/\bspiritual\b/.test(n) && !wellnessStrong && !educationStrong)) {
    return 'devotional';
  }
  if (musicStrong) {
    return 'music';
  }
  if (gamingStrong) {
    return 'gaming';
  }
  if (educationStrong) {
    return 'education';
  }
  if (wellnessStrong || /\b(meditation|sleep\s+music)\b/.test(n)) {
    return 'wellness';
  }
  if (/\b(entertainment|comedy|funny|sketch|skit|roast|prank|meme|reaction|movie|film|trailer|ott|web series|celebrity|bollywood|tollywood|kollywood|tv show|cinema|short film|drama|moral story)\b/.test(n)) {
    return 'entertainment';
  }
  if (/\b(travel|traveller|traveler|tourism|trip|journey|destination|vlog|vlogs|daily vlog|family vlog|lifestyle|day in my life|water park|hill station|food|recipe|cooking|chef|kitchen|restaurant|street\s+food|food tour)\b/.test(n)) {
    return 'experience';
  }
  return null;
}

// ── Specificity scoring ───────────────────────────────────────────────────────
// Measures whether a recommendation topic names a concrete subject.
// 0 = pure format directive with no named entity. 100 = named entity + specific angle.
// Used to gate format-only output and to attach specificity_score to every idea.

const _SF_DIRECTIVE_RE = /^(make a|make an|create a|record a|post a|do a|film a)\b/i;
const _SF_PAYOFF_RE    = /with a clear payoff\b/i;
const _SF_ENTITY_STOP  = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'your', 'from', 'into', 'have',
  'will', 'more', 'than', 'just', 'like', 'some', 'also', 'over', 'which', 'there',
  'their', 'would', 'could', 'should', 'after', 'before', 'about', 'make', 'what',
  'when', 'why', 'how', 'who', 'can', 'top', 'best', 'new', 'all', 'every', 'most',
  'one', 'two', 'big', 'real', 'true', 'way', 'ways', 'tips', 'time', 'life',
  'people', 'world', 'good', 'you', 'are', 'its', 'was', 'has', 'not', 'out', 'get',
]);

function _sfCountEntities(topic) {
  const words = String(topic || '').split(/[\s\-—–:,!?|#@]+/).slice(1);
  return words.filter(w => {
    const c = w.replace(/[^a-zA-Z]/g, '');
    return c.length >= 3 && /^[A-Z]/.test(c) && !_SF_ENTITY_STOP.has(c.toLowerCase());
  }).length;
}

function computeSpecificityScore(topic) {
  const t = String(topic || '').trim();
  if (!t) return 0;
  const entities  = _sfCountEntities(t);
  const hasNumber = /\d/.test(t);
  const isDirective = _SF_DIRECTIVE_RE.test(t);

  if (isDirective) {
    // "Make a Roblox challenge" has entity → low-but-not-zero; pure "Make a mindset video" → ~3
    if (entities === 0 && !hasNumber) return _SF_PAYOFF_RE.test(t) ? 3 : 8;
    return Math.min(35, 15 + entities * 12 + (hasNumber ? 5 : 0));
  }

  let score = 35;
  score += Math.min(30, entities * 10);
  if (/\b\d{4}\b/.test(t))                                                         score += 12; // year
  if (/\b\d+\s*(x|%|ways|reasons|tips|mistakes|things|steps)\b/i.test(t))          score += 14; // count/stat
  else if (/\b\d+\b/.test(t))                                                       score +=  8; // other number
  if (t.length >= 50) score += 10;
  else if (t.length >= 35) score +=  6;
  else if (t.length  < 20) score -= (entities >= 1 || hasNumber ? 8 : 15);
  if (/[—–:]/.test(t) && entities > 0) score += 8; // specific sub-angle after named entity
  return Math.max(0, Math.min(100, Math.round(score)));
}

// Returns true only for format-directive topics that name NO entity and NO number.
// These are suppressed: "Make a mindset video with a clear payoff" → true.
// Kept: "Make a Roblox challenge" (entity=Roblox) → false.
function isFormatOnlyTopic(topic) {
  const t = String(topic || '').trim();
  return _SF_DIRECTIVE_RE.test(t) && _sfCountEntities(t) === 0 && !/\d/.test(t);
}

// ── Main entry point ─────────────────────────────────────────────────────────
function computeCreativeOpportunities(peerVideos, { niche = '', minPeerCount = 2 } = {}) {
  if (!peerVideos || peerVideos.length === 0) return [];

  const familyKey = detectFamily(niche);
  if (!FAMILY_CONFIG[familyKey]) return [];

  const { axisMap, baselineAvg, totalVideos } = buildAxisMap(peerVideos, familyKey);
  if (axisMap.size === 0) return [];

  const singleAxes   = scoreSingleAxes(axisMap, minPeerCount, familyKey);
  const combinations = peerVideos.length >= 20
    ? scoreCombinations(peerVideos, familyKey, baselineAvg)
    : [];

  // Merge, prefer combinations when score is competitive
  const merged = prioritizeTopEvidence(
    [...combinations, ...singleAxes].sort((a, b) => b.score - a.score),
    familyKey,
  );

  const usedValues = new Set();
  const output     = [];

  for (const opp of merged) {
    if (output.length >= 10) break;

    const vals = opp.type === 'combination' ? opp.axes.map(a => a.value) : [opp.value];
    // Allow up to 3 overlap ideas in top output; after that skip fully-covered axes
    const allCovered = vals.every(v => usedValues.has(v));
    if (allCovered && output.length >= 3) continue;

    const { title, suggestion } = buildSuggestionV2(opp, familyKey);
    const sampleTitles = (opp.sample_titles || []).slice(0, 3);
    const peerExamples = sampleTitles.map(t => ({ title: t.title, views: t.views }));
    // Use top peer title for ALL families when available — converts "Make a Roblox funny moments
    // video" → the actual peer title "Top 5 Roblox moments that broke the internet".
    const usesPeerTitle = opp.type === 'single_axis' && opp.axis === 'format'
      && sampleTitles.length > 0;
    const finalTopic = usesPeerTitle ? sampleTitles[0].title : title;

    // Specificity gate: suppress format-only recommendations with no named entity or number.
    // Applies to both single-axis ("Make a mindset video") and combinations
    // ("Make a muscle gain transformation story with a clear payoff").
    // Language combinations ("Try a Hindi-language gameplay") always pass — "Try a" is not
    // a directive verb, and language names are named entities anyway.
    // Axis slot stays open so a higher-scoring candidate can fill it.
    if (!usesPeerTitle && isFormatOnlyTopic(finalTopic)) continue;

    // Mark axis values as used only for ideas we actually emit
    vals.forEach(v => usedValues.add(v));

    output.push({
      idea_type: 'creative_package',
      topic:     finalTopic,
      title:     finalTopic,
      examples:  peerExamples,
      family:    familyKey,
      format:    opp.type === 'combination' ? (opp.axes.find(a => a.axis === 'format')?.value ?? null) : (opp.axis === 'format' ? opp.value : null),
      mood:      opp.type === 'combination' ? (opp.axes.find(a => a.axis === 'mood')?.value ?? null)   : (opp.axis === 'mood'   ? opp.value : null),
      occasion:  opp.type === 'combination' ? (opp.axes.find(a => a.axis === 'occasion')?.value ?? null) : (opp.axis === 'occasion' ? opp.value : null),
      language:  opp.type === 'combination' ? (opp.axes.find(a => a.axis === 'language')?.value ?? null) : (opp.axis === 'language' ? opp.value : null),
      suggestion,
      score:         opp.score,
      source:        'peer_signal',
      evidence:      opp.evidence,
      format_evidence: opp.evidence?.format_evidence ?? null,
      evidence_type:   opp.evidence?.format_evidence?.evidence_type ?? null,
      specificity_score: computeSpecificityScore(finalTopic),
    });
  }

  return prioritizeOutputTopEvidence(output, familyKey);
}

// ── Evergreen fallback suggestions per family ────────────────────────────────
// Appended when the creative engine produces < 5 ideas.
// Marked source:'fallback_evergreen', confidence:'low' by the caller.
function getEvergreenFallback(niche, contextHint = '') {
  const family = detectFamily(niche);

  if (family === 'devotional') {
    // Religion/tradition-aware: the generic devotional fallback was Hindu-only, so Sikh /
    // Islamic / Christian channels got bhajan/aarti/chalisa seeds (wrong tradition).
    const t = `${niche} ${contextHint}`.toLowerCase();
    if (/\b(sikh|gurbani|shabad|kirtan|gurdwara|waheguru|khalsa|simran|nitnem|paath|granth|vaisakhi|gurpurab|nanak)\b/.test(t)) {
      return [
        { idea_type: 'creative_package', family: 'devotional', format: 'kirtan', title: 'Daily shabad kirtan (under 5 minutes)', suggestion: 'Record a short, clean shabad kirtan — voice and simple accompaniment. Daily devotional Shorts build the subscription habit faster than occasional long uploads.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'gurbani', title: 'Gurbani vichaar with plain-language meaning', suggestion: 'Take one shabad or pankti and explain its meaning in plain language. Sangat who understand the meaning watch longer and share more.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'simran', title: 'Waheguru simran loop (1-hour version)', suggestion: 'Loop a simran/gurbani recitation for 1 hour with a calm static or gently animated visual. 1-hour loops get far higher watch time than standard uploads.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'occasion', title: 'Gurpurab / Vaisakhi special kirtan with on-screen lyrics', suggestion: 'Record an occasion-specific kirtan with on-screen Gurmukhi + transliteration. Gurpurab/Vaisakhi content spikes around the date and stays evergreen year-round.', evidence: null },
      ];
    }
    if (/\b(islam|muslim|quran|qur'?an|naat|hamd|nasheed|dua|zikr|dhikr|qawwali|allah|ramadan|eid|sufi|tilawat)\b/.test(t)) {
      return [
        { idea_type: 'creative_package', family: 'devotional', format: 'naat', title: 'Short daily naat or hamd (under 5 minutes)', suggestion: 'Record a short, clean naat or hamd — voice-forward, minimal production. Daily devotional Shorts build the subscription habit fast.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'tilawat', title: 'Quran recitation with on-screen translation', suggestion: 'Recite a short surah/ayah with on-screen translation. Listeners who understand the meaning watch longer and share more.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'zikr', title: 'Dua / zikr loop (1-hour version)', suggestion: 'Loop a dua or zikr for 1 hour with a calm visual. 1-hour loops get far higher watch time than standard uploads.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'occasion', title: 'Ramadan / Eid special recitation with meaning', suggestion: 'Record an occasion-specific recitation with translation. Ramadan/Eid content spikes around the date and stays evergreen for next year.', evidence: null },
      ];
    }
    if (/\b(christ|gospel|worship|jesus|bible|hymn|psalm|church|prayer\s+song)\b/.test(t)) {
      return [
        { idea_type: 'creative_package', family: 'devotional', format: 'worship', title: 'Short daily worship song (under 5 minutes)', suggestion: 'Record a short, clean worship song — voice-forward, minimal production. Daily devotional Shorts build the subscription habit fast.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'hymn', title: 'Hymn with on-screen lyrics and meaning', suggestion: 'Record a hymn with on-screen lyrics and a short reflection on its meaning. Viewers who follow the words watch longer and share more.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'scripture', title: 'Scripture / psalm reading with reflection', suggestion: 'Read a psalm or passage and add a short plain-language reflection. Meaning-led content earns longer watch time.', evidence: null },
        { idea_type: 'creative_package', family: 'devotional', format: 'loop', title: 'Worship / instrumental prayer loop (1-hour version)', suggestion: 'Loop worship instrumentals for 1 hour with a calm visual. 1-hour loops get far higher watch time than standard uploads.', evidence: null },
      ];
    }
    return [
      { idea_type: 'creative_package', family: 'devotional', format: 'bhajan',  title: 'Short daily bhajan (under 5 minutes)', suggestion: 'Record a short, clean bhajan — no production complexity, just voice and a simple instrument. Daily devotional Shorts build subscription habit faster than occasional long uploads.', evidence: null },
      { idea_type: 'creative_package', family: 'devotional', format: 'aarti',   title: 'Festival aarti with on-screen lyrics', suggestion: 'Record a festival aarti (Ganesh, Durga, Lakshmi, Shiva) with on-screen Hindi lyrics. Festival-occasion content spikes around the festival date and stays evergreen for the next year.', evidence: null },
      { idea_type: 'creative_package', family: 'devotional', format: 'stotra',  title: 'Chalisa with plain-language meaning', suggestion: 'Record a chalisa or stotra and add a plain-language meaning explanation. Devotees who understand the meaning watch more and share more.', evidence: null },
      { idea_type: 'creative_package', family: 'devotional', format: 'mantra',  title: 'Morning mantra loop (1-hour looping version)', suggestion: 'Take an existing mantra or chant, loop it for 1 hour with a static or gently animated visual. 1-hour loops get 5–10× the watch time of standard uploads.', evidence: null },
    ];
  }

  if (family === 'gaming') {
    return [
      { idea_type: 'creative_package', family: 'gaming', format: 'update', title: 'Break down the latest update and what players should do next', suggestion: 'Open with the biggest change, show what it affects in real gameplay, then end with the one setting, weapon, map route, or tactic viewers should try first.', evidence: null },
      { idea_type: 'creative_package', family: 'gaming', format: 'challenge', title: 'Create a challenge run with one clear rule', suggestion: 'Pick one restriction viewers understand instantly: one life, one weapon, no healing, low-end device, or solo-vs-squad. Keep the payoff visible from the title and first 10 seconds.', evidence: null },
      { idea_type: 'creative_package', family: 'gaming', format: 'tips_guide', title: 'Make a settings, sensitivity, or loadout guide for beginners', suggestion: 'Give one practical setup, explain who it is for, then prove it in a short match segment. Practical gaming guides work best when the result is visible.', evidence: null },
      { idea_type: 'creative_package', family: 'gaming', format: 'gameplay', title: 'Explain one full match decision by decision', suggestion: 'Turn normal gameplay into a useful breakdown: why you rotated, why you fought, what mistake almost cost the match, and what viewers should copy.', evidence: null },
      { idea_type: 'creative_package', family: 'gaming', format: 'funny_moments', title: 'Package funny moments around one setup and payoff', suggestion: 'Do not just clip random moments. Set up one expectation, build three escalating moments, and end with the funniest or most surprising payoff.', evidence: null },
    ];
  }

  if (family === 'sports') {
    return [
      { idea_type: 'creative_package', family: 'sports', format: 'match_preview', title: 'Preview the match through three key battles', suggestion: 'Pick the three matchups that can actually decide the result: opener vs new ball, striker vs defender, captaincy choice, or death-over matchup. End with a clear prediction.', evidence: null },
      { idea_type: 'creative_package', family: 'sports', format: 'post_match_analysis', title: 'Post-match: three moments that changed everything', suggestion: 'Do not recap the whole match. Pick the three turning points, explain why each mattered, and show what fans are overreacting to.', evidence: null },
      { idea_type: 'creative_package', family: 'sports', format: 'player_form', title: 'Player form breakdown: what changed recently', suggestion: 'Compare recent form to the player’s normal baseline: role, confidence, technique, fitness, team usage, and what to expect next.', evidence: null },
      { idea_type: 'creative_package', family: 'sports', format: 'lineup_debate', title: 'Best XI or lineup debate with a clear final call', suggestion: 'Frame the video around the hardest selection call. Show both sides, make your final XI, and explain the one risk in your choice.', evidence: null },
      { idea_type: 'creative_package', family: 'sports', format: 'fantasy_team', title: 'Fantasy team: safe picks, risk picks, captain choice', suggestion: 'Split the team into safe picks, differential picks, and avoid picks. End with captain and vice-captain logic, not just names.', evidence: null },
    ];
  }

  if (family === 'entertainment') {
    return [
      { idea_type: 'creative_package', family: 'entertainment', format: 'sketch', title: 'Recurring character sketch with one clear conflict', suggestion: 'Build a repeatable character or situation and change only the conflict each episode. It creates familiarity without copying a peer title.', evidence: null },
      { idea_type: 'creative_package', family: 'entertainment', format: 'reaction', title: 'Reaction format with a visible payoff', suggestion: 'Set up the reaction before the clip: who is reacting, what they expect, and what surprise the audience is waiting for.', evidence: null },
      { idea_type: 'creative_package', family: 'entertainment', format: 'recap', title: 'Fast recap before a new release or episode', suggestion: 'Summarize the story so far, then end with what viewers should watch for next. This works around releases without needing new footage.', evidence: null },
      { idea_type: 'creative_package', family: 'entertainment', format: 'ranking', title: 'Ranking/list with a controversial final pick', suggestion: 'Use a clear ranking promise and save the most debatable pick for last to drive comments.', evidence: null },
      { idea_type: 'creative_package', family: 'entertainment', mood: 'drama', title: 'Emotional twist story in under 60 seconds', suggestion: 'Open with the mistake, build one consequence, and end with the reversal. Short drama needs a clean emotional turn.', evidence: null },
    ];
  }

  if (family === 'experience') {
    return [
      { idea_type: 'creative_package', family: 'experience', format: 'itinerary', title: 'One-day itinerary with exact timings', suggestion: 'Turn a place or day into a clear plan: start time, transport, cost, food stop, mistake to avoid. It is more useful than a generic vlog.', evidence: null },
      { idea_type: 'creative_package', family: 'experience', format: 'budget', title: 'Full cost breakdown for a realistic trip/day', suggestion: 'Show every expense and end with what you would skip next time. Budget transparency makes experience content saveable.', evidence: null },
      { idea_type: 'creative_package', family: 'experience', format: 'honest_review', title: 'Was it actually worth it?', suggestion: 'Frame the video around an honest verdict: what matched expectations, what disappointed, and who should go.', evidence: null },
      { idea_type: 'creative_package', family: 'experience', format: 'hidden_gem', title: 'Hidden local spot most people miss', suggestion: 'Pick one undercovered place, food stop, market, or routine detail and explain why outsiders miss it.', evidence: null },
      { idea_type: 'creative_package', family: 'experience', format: 'day_in_life', title: 'Full day story built around one unusual detail', suggestion: 'Keep the vlog personal, but make one specific detail the hook so it is not just another daily upload.', evidence: null },
    ];
  }

  if (family === 'education') {
    return [
      { idea_type: 'creative_package', family: 'education', format: 'concept_explainer', title: 'One concept explained with three examples', suggestion: 'Pick one narrow concept, explain it simply, then use three examples: beginner, practical, and exam/application. This is more useful than a broad lecture.', evidence: null },
      { idea_type: 'creative_package', family: 'education', format: 'mistakes', title: '5 common mistakes beginners make', suggestion: 'Teach through mistakes: show the wrong answer/process first, then the corrected version. This makes the lesson concrete and saveable.', evidence: null },
      { idea_type: 'creative_package', family: 'education', format: 'revision', title: 'Quick revision sheet before the test', suggestion: 'Compress the topic into definitions, formulas/rules, common traps, and two practice questions. Revision content is high-utility and repeatable.', evidence: null },
      { idea_type: 'creative_package', family: 'education', format: 'quiz', title: 'Pause-and-answer quiz format', suggestion: 'Ask the question first, pause, then explain the answer. This creates interaction even without comments or live class.', evidence: null },
      { idea_type: 'creative_package', family: 'education', format: 'tutorial', title: 'Step-by-step tutorial from zero', suggestion: 'Start from the exact beginner starting point and show every step without skipping. Zero-to-one tutorials are evergreen and searchable.', evidence: null },
    ];
  }

  if (family === 'wellness') {
    return [
      { idea_type: 'creative_package', family: 'wellness', format: 'routine_test', title: '7-day routine test with honest results', suggestion: 'Pick one routine, test it for a week, and show the exact changes, misses, and result. Experiments are more credible than advice-only videos.', evidence: null },
      { idea_type: 'creative_package', family: 'wellness', format: 'mistakes', title: 'Common mistake and the correct fix', suggestion: 'Show the wrong version first, then the corrected technique or habit. Mistake-led framing makes health and self-improvement content practical.', evidence: null },
      { idea_type: 'creative_package', family: 'wellness', format: 'beginner_plan', title: 'Beginner plan for the first week', suggestion: 'Make a simple week-one plan with what to do, what to avoid, and how to measure progress. This gives new viewers a clear starting point.', evidence: null },
      { idea_type: 'creative_package', family: 'wellness', format: 'full_day', title: 'Full day breakdown: food, movement, recovery', suggestion: 'Show the full day instead of one isolated tip. Viewers can copy the structure even if they change the details.', evidence: null },
      { idea_type: 'creative_package', family: 'wellness', format: 'myth_busting', title: 'Myth vs reality about one common belief', suggestion: 'Choose one popular belief and explain what is true, what is exaggerated, and what viewers should actually do.', evidence: null },
    ];
  }

  if (family !== 'music') return [];

  return [
    { idea_type: 'creative_package', family: 'music', format: 'acoustic',      title: 'Acoustic/unplugged version of your best-performing song', suggestion: 'Re-release your top song in an acoustic format — single instrument, one take, intimate setting. This format consistently outperforms original uploads on smaller channels.', evidence: null },
    { idea_type: 'creative_package', family: 'music', format: 'lyric_video',   title: 'Lyric video with animated subtitles', suggestion: 'Create a lyric video for any of your originals or covers. Clean typography on a single colour background. Low production cost, high shareability.', evidence: null },
    { idea_type: 'creative_package', family: 'music', format: 'behind_song',   title: 'Behind-the-song: story and process for your most personal track', suggestion: 'Share the story behind one existing song — where the idea came from, what the lyrics mean, how the production came together. No music production needed. Builds deep audience connection.', evidence: null },
    { idea_type: 'creative_package', family: 'music', format: 'slowed_reverb', title: 'Slowed + reverb version for the late-night audience', suggestion: 'Take an existing track, apply slowed reverb processing, add a lo-fi visual loop. This format has exploded in Indian music and requires no new recording — just audio processing and a static thumbnail.', evidence: null },
    { idea_type: 'creative_package', family: 'music', occasion: 'wedding',     title: 'Wedding-season original or cover (mehndi, sangeet, or reception mood)', suggestion: 'Record a wedding-occasion original or cover. Wedding content has a built-in seasonal demand spike and gets shared heavily in wedding planning groups.', evidence: null },
  ];
}

// Wrap getEvergreenFallback so every returned idea has `topic` set to `title`.
// The frontend uses idea.topic as the primary display/key field — creative_package
// ideas use `title`, so we alias it here rather than touching every object literal.
function getEvergreenFallbackWrapped(niche, contextHint = '') {
  return getEvergreenFallback(niche, contextHint || niche).map(o => ({ ...o, topic: o.title, examples: o.examples ?? [] }));
}

module.exports = { computeCreativeOpportunities, getEvergreenFallback: getEvergreenFallbackWrapped, detectFamily, FAMILY_CONFIG, computeSpecificityScore };
