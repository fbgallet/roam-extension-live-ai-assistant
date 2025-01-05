export const defaultAssistantCharacter = `You are a smart, rigorous and concise AI assistant. You always respond in the same language as the user's prompt unless specified otherwise in the prompt itself.`;

export const hierarchicalResponseFormat = `\n\nIMPORTANT RULE on your response format (ONLY FOR HIERARCHICALLY STRUCTURED RESPONSE): If your response contains hierarchically structured information, each sub-level in the hierarchy should be indented exactly 2 spaces more relative to the immediate higher level. DO NOT apply this rule to successive paragraphs without hierarchical relationship (as in a narrative)! When a response is better suited to a form written in successive paragraphs without hierarchy, DO NOT add indentation and DO NOT excessively subdivide each paragraph.`;
// For example:
// 1. First level (0 space)
//   a) Level 2 (2 spaces)
//     Level 3 (4 spaces)
//   b) Level 2

export const defaultContextInstructions = `
Below is the context of the user request: it can consist of data to rely on, content to apply to the user instructions or additional instructions, depending on the user's prompt.
If your response will include exactly the content of an existing block, you can strictly replace this content by the ((9-characters code)) block reference: you have to choose: the content or the block reference, NOT BOTH.
The ((9-characters code)) within double parentheses preceding each piece of content (or block) in the context is its ID in the database and is called 'block reference'. IF AND ONLY IF (take into account this condition) sourcing is requested by the user and ONLY IF (take into account this condition) it adds some information not already in your response, you can refer to an existing block using the syntax ([source](((9-characters code)))) to refer to it as a note or citation at the end of a sentence relying on its content. Example: Some sentence... ([source](((kVZwmFnFF)))).
VERY IMPORTANT: you can ONLY refer to one of those that is currently present in the context!`;

export const contextAsPrompt = `Follow the instructions provided in the context \
(the language in which they are written will determine the language of the response).`;

// For Post-Processing

export const instructionsOnJSONResponse =
  ' Your response will be a JSON objects array with the following format, respecting strictly the syntax, \
especially the quotation marks around the keys and character strings: \
{"response": [{"uid": "((9-characters-code))", "content": "your response for the corresponding line"}, ...]}".';

export const specificContentPromptBeforeTemplate = `\
Complete the template below, in accordance with the following content, statement or request, and any formatting instructions provided \
(the language in which the template is written will determine the language of your response): \n\n`;

export const instructionsOnTemplateProcessing = `Instructions for processing the template below: each item to complete has a ((9-characters-code)) to record in the JSON array, in a strictly accurate manner. Follow precisely the instructions provided in each item:
- each prompt has to be completed, each [placeholder] has to be replaced by the appropriate content,
- each question or request has to be answered in detail without exception.
- some elements, such as titles, heading keys or indication of the type of expected response at the beginning of a line, usually followed by a colon, should be kept and reproduced exactly to aid understanding
(for example the prompt 'Capital: [of France]\\nLanguage:' will be completed as 'Capital: Paris\\nLanguage: french').

Here is the template:\n`;

const outputConditions = `IMPORTANT:
- respond only with the requested content, without any introductory phrases, explanations, or comments.
- you have to write your response in the same language as the following provided content to process.

Here is the user content to <ACTION>:
`;

export const completionCommands = {
  translate: `YOUR JOB: Translate the following content into clear and correct <language> (without verbosity or overly formal expressions), taking care to adapt idiomatic expressions rather than providing a too-literal translation.

  OUTPUT FORMAT:
  - Provide only the translation directly and nothing else, WITHOUT any introductory phrase or comment, unless they are explicity requested by the user.
  - Don't insert any line breaks if the provided statement doesn't have line breaks itself.
  
  Here is the content to translate:`,

  summarizePrompt: `Please provide a concise, cohesive summary of the following content, focusing on:
- Essential main ideas and key arguments
- Critical supporting evidence and examples
- Major conclusions or recommendations
- Underlying themes or patterns
Keep the summary significantly shorter than the original while preserving core meaning and context. Present it in well-structured paragraph(s) that flow naturally, avoiding fragmented bullet points. If the content has a clear chronological or logical progression, maintain this structure in your summary.
${outputConditions.replace("<ACTION>", "summarize")}:`,

  rephrase: `Please rephrase the following text, keeping exactly the same meaning and information, but using different words and structures. Use natural, straightforward language without jargon or flowery vocabulary. Ensure the paraphrase sounds idiomatic in the used language. Maintain the original tone and level of formality.
${outputConditions.replace("<ACTION>", "rephrase")}`,

  shorten: `Please rephrase the following text to be more concise while closely preserving its original style, tone, and intent. Keep the same key phrases and expressions where possible, only removing redundancies and shortening overly complex sentences. The result should be immediately recognizable as a more streamlined version of the source text, without changing its essential character or voice. Maintain the same level of formality and all core ideas.
${outputConditions.replace("<ACTION>", "shorten")}`,

  accessible: `Rephrase the following text using simpler, more accessible language while keeping all the information. Avoid complex sentences and technical terms. The result should be easily understood by a general audience.
  ${outputConditions.replace("<ACTION>", "rephrase")}`,

  clearer: `Please rephrase the following text while following these specific guidelines:
  1. Maintain the core meaning and main ideas of the original text
  2. Keep a similar tone and style to preserve the author's voice
  3. Break down complex or lengthy sentences into clearer, more digestible ones
  4. Make clearer any vague or ambiguous or implicit statements by explaining its precise meaning
  5. Replace any jargon or flowery vocabulary with clearer alternatives
  6. Ensure each sentence is self-contained and fully understandable
  7. Eliminate redundant or empty phrases
  8. Keep some original phrasing where it effectively serves the message
  9. Make every word count and serve a clear purpose
The reformulated text should be more accessible while remaining faithful to the original's intent and character.
${outputConditions.replace("<ACTION>", "rephrase")}`,

  formal: `Rephrase the following text using more formal language and structure, while preserving all information. Keep it natural and professional, without being pompous. Use standard business language conventions.
  ${outputConditions.replace("<ACTION>", "rephrase")}`,

  casual: `"Rephrase the following text in a more casual, conversational tone. Keep all the information but make it sound like natural spoken language. Use common expressions and straightforward structure while maintaining accuracy.
  ${outputConditions.replace("<ACTION>", "rephrase")}`,

  correctWording: `Please provide only the corrected version of the following text, fixing spelling, grammar, syntax and sentence structure errors while keeping the exact same meaning and wording wherever possible. If a word is clearly inappropriate, you can adapt the vocabulary as needed to make it more in line with usage in the target language. Do not rephrase or reformulate content unless absolutely necessary for correctness.
${outputConditions.replace("<ACTION>", "fix")}:`,

  outline: `Please convert the following text into a hierarchically structured outline that reflects its logical organization. Important requirements:
  1. Maintain the exact original wording and expressions when breaking down the content
  2. Use appropriate levels of indentation to show the hierarchical relationships
  3. Structure the outline so that the logical flow and relationships between ideas are immediately visible
  4. Keep all content elements but reorganize them to show their relative importance and connections
  5. Use consistent formatting with clear parent-child relationships between levels
  6. Begin each bullet point with "-" character
Do not paraphrase or modify the original text - simply reorganize it into a clear hierarchical structure that reveals its inherent logic.
${outputConditions.replace("<ACTION>", "convert")}`,

  linearParagraph: `Transform the following hierarchically organized outline into a continuous text while strictly preserving the original wording of each element. Follow the hierarchical order, add minimal connecting words or phrases where necessary for fluidity, but never modify the original formulations. As much as possible, if the content naturally flows as a single development, present it as one paragraph. However, if distinct thematic developments are clearly identifiable, develop multiple parargaphs but as little as necessary for the clarity of the point and without any hierarchy or indentation.
  ${outputConditions.replace("<ACTION>", "transform")}`,

  example: `Provide a paradigmatic example that illustrates the idea or statement provided below. Make it concrete, vivid, and thought-provoking while capturing the essence of what it exemplifies. Express it in clear, straightforward language without any introductory phrases or commentary.
  ${outputConditions.replace("<ACTION>", "examplifly")}`,

  argument: `Generate a robust argument (only one) supporting the provided statement or idea.

Required characteristics:
Ensure logical structure:
- Present clear premises leading to a conclusive reasoning, but exclude any logical meta-discourse
- Support claims with concrete evidence or established principles
- Maintain rigorous logical connections between steps
Follow domain-matching principles:
- Draw evidence from the same field as the input statement
- If referencing a classical argument, cite its origin
Development requirements:
- Provide sufficient detail to make reasoning transparent but still be concise
- Don't scatter your argument - focus on developing just one line of reasoning in depth
- Maintain focus throughout the argumentation
Guarantee clarity:
- Present argument directly without meta-commentary
- Define key concepts explicitly
- Use clear, straightforward, precise and unambiguous language
- Maintain a neutral, academic tone
${outputConditions.replace("<ACTION>", "justify")}`,

  challengeMyIdeas: `Act as a rigorous critical thinker and challenge the ideas I will present by:
- Identifying key hidden assumptions and questioning their validity
- Pointing out potential logical flaws or inconsistencies
- Highlighting practical implementation challenges
- Raising specific counterexamples that test the robustness of the reasoning
- Suggesting alternative perspectives that could lead to different conclusions
Keep your response focused on only 2-3 most significant challenges. Be direct and specific in your questions. Aim to deepen the analysis rather than dismiss the ideas.
${outputConditions.replace("<ACTION>", "be challenged")}`,

  extractHighlights: `As a text extraction assistant, your task is to process input text and extract only the highlighted portions (text between double ^^ markers). Follow these exact rules:

1. Extraction rules:
  - Extract ONLY text between ^^ markers (e.g., from "^^highlighted text^^", extract "highlighted text")
  - Maintain the exact content without adding or removing anything
  - Remove the ^^ markers in the output
  - Keep the original text's order

2. Source block referencing:
If the source blocks have unique ID (9-character string in double parentheses, containing alphanumeric, - or _):
  - Add a markdown reference link immediately after each extract in this exact format: [*](((unique ID of the block)))
  - Place the reference on the same line as the extract
  - Carefully verify that the unique ID used to reference the source block contains strictly 9 characters and exactly matches the one indicated at the beginning of the block if applicable.
  - Do not invent an identifier if there isn't one! If there is no identifier available, do not insert any mardown reference: doesn't add anything to the extracted text.

3. Format requirements:
  - Present each extraction in a bullet point, separated from the precedent by a line break
  - Preserve exact spelling and punctuation
  - Do not add any commentary or modifications
  - Do not extract non-highlighted text
  - Do not add any introductory text.

Example:
Input: "((abc123-d_)) Some text with ^^highlighted portion^^ in it"
Output: "- highlighted portion [*](((abc123-d_)))"
${outputConditions.replace("<ACTION>", "extract higlights from")}`,
};

export const socraticPostProcessingPrompt = `\
Comment on the user's statement in a manner similar to Socrates in Plato's dialogues, \
with humor and feigned naivety that actually aims to provoke very deep reflection.
Three paragraphs: first, show your agreement with what is being said, then raise an objection and \
ask a question about one of the fundamental beliefs implicit in the following user statement \
(important: the language in which the following statement or question is written determine the language of your response):\n\n`;
