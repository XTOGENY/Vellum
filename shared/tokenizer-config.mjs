// Converts the vendor's public vocabulary data to Hugging Face's standard format.
// This adapter is independent of the reference application's tokenizer implementation.
export function tokenizerConfig(kind, data) {
  if (kind === "t5") return data;
  if (kind === "qwen")
    return {
      version: "1.0",
      added_tokens: data.specialTokens.map((content) => ({
        id: data.vocab[content],
        content,
        single_word: false,
        lstrip: false,
        rstrip: false,
        normalized: false,
        special: true,
      })),
      normalizer: { type: "NFC" },
      pre_tokenizer: {
        type: "Sequence",
        pretokenizers: [
          {
            type: "Split",
            pattern: { Regex: data.config.splitRegex },
            behavior: "Isolated",
            invert: false,
          },
          {
            type: "ByteLevel",
            add_prefix_space: false,
            trim_offsets: true,
            use_regex: false,
          },
        ],
      },
      model: {
        type: "BPE",
        vocab: data.vocab,
        merges: data.merges,
        unk_token: null,
        byte_fallback: false,
        ignore_merges: data.config.ignoreMerges,
      },
      decoder: { type: "ByteLevel" },
      post_processor: null,
    };
  if (kind !== "clip") throw new Error("未知词表");
  const bytes = [];
  for (let i = 33; i <= 126; i++) bytes.push(i);
  for (let i = 161; i <= 172; i++) bytes.push(i);
  for (let i = 174; i <= 255; i++) bytes.push(i);
  const chars = [...bytes];
  let n = 0;
  for (let i = 0; i < 256; i++)
    if (!bytes.includes(i)) {
      bytes.push(i);
      chars.push(256 + n++);
    }
  const symbols = chars.map((c) => String.fromCharCode(c)),
    merges = data.text
      .split("\n")
      .slice(1, 48895)
      .map((x) => x.trim().split(" "))
      .filter((x) => x.length === 2),
    tokens = [
      ...symbols,
      ...symbols.map((s) => s + "</w>"),
      ...merges.map((pair) => pair.join("")),
      "<|startoftext|>",
      "<|endoftext|>",
    ];
  return {
    version: "1.0",
    added_tokens: [],
    normalizer: {
      type: "Sequence",
      normalizers: [
        { type: "Lowercase" },
        { type: "Replace", pattern: { Regex: "\\s+" }, content: " " },
        { type: "Strip", strip_left: true, strip_right: true },
      ],
    },
    pre_tokenizer: {
      type: "Sequence",
      pretokenizers: [
        {
          type: "Split",
          pattern: {
            Regex:
              "<\\|startoftext\\|>|<\\|endoftext\\|>|'s|'t|'re|'ve|'m|'ll|'d|[\\p{L}]+|[\\p{N}]|[^\\s\\p{L}\\p{N}]+",
          },
          behavior: "Removed",
          invert: true,
        },
        { type: "ByteLevel", add_prefix_space: false, use_regex: false },
      ],
    },
    model: {
      type: "BPE",
      vocab: Object.fromEntries(tokens.map((s, i) => [s, i])),
      merges,
      continuing_subword_prefix: "",
      end_of_word_suffix: "</w>",
      unk_token: "<|endoftext|>",
    },
    decoder: { type: "BPEDecoder", suffix: "</w>" },
    post_processor: null,
  };
}
export function countableText(text) {
  return String(text)
    .replace(/-?\d+(?:\.\d+)?::/g, "")
    .replace(/::/g, "")
    .replace(/[{}\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
