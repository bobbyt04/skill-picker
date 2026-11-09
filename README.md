# Skill Picker

A **Skills panel** for Claude Code Desktop, with suggestions as you type.

- **Every skill in one place:** your own skills, plugin skills and skill packs, in sections that open on a click. Each skill is one line: its command and a short description.
- **Search:** one box searches every section, by name and by description.
- **Click to use:** clicking a skill puts `/skill-name` at the front of your message. The row says "added".
- **Favorites:** point at a skill and click **Pin** to keep it at the top.
- **Most used:** the five skills you click most, counted on your computer.
- **Suggestions as you type:** pause while typing a message of 4 or more words and [Jev](https://typesafe.ai), a cheap decision model, picks up to three skills that fit. The best one shows above the prompt box and in the panel, with a match score and a **Use** button. All three come from one check.
- **Turn suggestions on or off:** the **Suggest** button next to the search box. Off means no checks and no cost. Your choice is remembered.
- **Hide what you don't use:** point at a skill or section and click **Hide**. The **Hidden** list at the bottom brings it back.
- **Live pixel art:** the word SKILLS in moving pixels at the top changes with what the panel is doing: waiting, checking, or found one. A small chart shows your skill use over the last 7 days.
- **Colors:** Purple, Amber, Green or Mono, picked at the bottom of the panel.

## Install

In Claude Code, run:

```
/plugin install skill-picker --marketplace bobbyt04/skill-picker
```

Then start a new chat. The panel opens on the right. If it doesn't, type `/skill-picker:open`.

Requires a recent Claude Code Desktop that supports mods.

## Turn on suggestions (optional)

The panel works as a skill browser without this step. Suggestions need a TypeSafe API key:

1. Create a key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys).
2. Add it to the `env` block of `~/.claude/settings.json`:
   ```json
   "env": { "TYPESAFE_API_KEY": "your-key" }
   ```
3. Start a new chat. The button next to the search box says "Suggest: on".

**Cost:** about $0.0004 per check, which Jev charges to your key. The panel shows the running total.

## Good to know

- **First message:** in a brand-new chat, suggestions start after you send the first message, because Claude Code runs the panel only once the chat has begun.
- **Who sees what:** when a key is set, the message you're typing (up to 4,000 characters) and your skill names and descriptions are sent to TypeSafe's API to choose a skill. Nothing is sent without a key.
- **Use counts:** the panel counts which skills you click, and how many per day for the last 14 days, to fill **Most used** and the chart. The counts stay on your computer and never include what you typed.
- **Debug logs:** the panel keeps a short local log in `~/.claude/skill-picker-logs/` (clicks, and the first 60 characters of each checked draft) to help fix problems. It never leaves your computer, and you can delete it any time.
- **Hover:** the desktop app doesn't animate rows on hover. Rows highlight instead.

## Updates

This is an early version, and updates are coming to make it better. Ideas and bug reports are welcome on the GitHub Issues page.

When a new version is out, the panel shows **Update ready** at the top. To get it:

```
/plugin update skill-picker
```

Then restart Claude. To get updates automatically, turn on auto-update for this plugin in the `/plugin` menu.

The update check downloads this repo's version number from GitHub at most twice a day. It sends nothing about you.

## License

MIT
