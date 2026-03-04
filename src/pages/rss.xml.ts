import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import type { APIContext } from "astro";

export async function GET(context: APIContext) {
  const posts = await getCollection("blog", ({ data }) => !data.draft);

  return rss({
    title: "Artemio Padilla — Blog",
    description:
      "Deep learning, AI engineering, and technical insights by Artemio Padilla.",
    site: context.site!,
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((post) => ({
        title: post.data.title,
        pubDate: post.data.pubDate,
        description: post.data.description,
        link: `/blog/${post.id}/`,
        categories: post.data.tags,
      })),
    customData: `<language>en-us</language>`,
  });
}
