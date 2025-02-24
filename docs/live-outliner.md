# Live Outliner

Live Outliner is a new way to use generative AI by taking advantage of the tree structure of an outliner like Roam, to fit generated content into a predefined yet flexible structure, avoiding redundancy and unnecessary length that sometimes comes with a chat. You no longer have to adapt your requests to the form of a long chat; it's up to the AI to adapt to the structure that suits your needs. AI responses will modify or be inserted into the existing outline, and only new elements will be added, instead of a long series of prompts and responses that often have a lot of redundancy.

NB: The agent requires fairly strong AI models, it works well with GPT-4 or DeepSeek, but for now, it's not compatible with Gemini models and the results are unreliable with lighter models.

It's easy to use:

- first you choose which set of blocks will be the active Live Outline, the set of blocks that can be modified or completed by the Live Outliner Agent. To do this, point to the parent block of the target blocks and click on the Live Outliner icon or the `Set as active Live Outline` command in the context menu. The affected blocks will then be surrounded by a blue halo.

- from now on, the prompts you send to the AI will apply to this set of blocks (if you click on the Live Outliner icon which is now on a contrasting background, or the `Apply selected blocks as prompt` command). The agent will be able to modify existing blocks (their content or format), add or remove them, and it will plan the required changes to respond to your request.
- you can make as many requests to the AI as you want, and each time, it's the current state of the outline that's taken into account (and a possible context). After each modification to the Live outline (changed or added blocks are highlighted in orange), you can revert to the previous state if the result isn't satisfactory. You can of course modify it manually, since it's always part of your graph. When a live outline is active, you can keep using your graph as usual, even close the page with the live outline, and it will automatically reappear in the sidebar when you request a new modification.
- To stop the Outliner Agent, click on the red cross or the `Disable current Live Outline` command.

## Favorite Live Outlines

To regularly update a Live Outline, save it as a favorite so you can modify it as needed. Just add the `#liveai/outline` tag to its parent block, and it will appear in the `Favorite Live Outlines` menu in the context menu and instantly open in the sidebar when you select it (or in the main view if the focus is in the sidebar).

Examples of use cases:

- regularly rephrase a list of principles or tips to actively review it
- progressively enrich and complete an AI-guided action plan

## Live Outline templates

If you want to regularly reuse the same template for new Live Outlines and have a predefined structure for the AI's responses, just add the #liveai/template tag to a given block. A copy of its child blocks will automatically be inserted into a new Live Outline when you select it via the `New Outline from template...` command.

Examples of use cases:

- a template to summarize the key ideas of an article you just read
- a structure for AI-assisted decision making
