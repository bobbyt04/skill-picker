# Skill Picker

A **Skills panel** for Claude Code Desktop, with suggestions as you type.

- **Every skill in one place:** your own skills, plugin skills and skill packs, grouped into folding sections with search.
- **Click to use:** clicking a skill puts `/skill-name` at the front of your message.
- **Suggestions as you type:** pause while typing a message of 4 or more words and [Jev](https://typesafe.ai), a cheap decision model, picks the skill that fits best. The pick shows above the prompt box and in the panel, with a match score and a **Use** button.
- **Hide what you don't use:** point at a skill or section and click **Hide**. The **Hidden** list at the bottom brings it back.
- **Purple pixel art:** an animated banner, a spark and a match meter.

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
3. Start a new chat. The top of the panel says "Jev suggestions on".

**Cost:** about $0.0004 per check, which Jev charges to your key. The panel shows the running total.

## Good to know

- **First message:** in a brand-new chat, suggestions start after you send the first message, because Claude Code runs the panel only once the chat has begun.
- **Who sees what:** when a key is set, the message you're typing (up to 4,000 characters) and your skill names and descriptions are sent to TypeSafe's API to choose a skill. Nothing is sent without a key.
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
