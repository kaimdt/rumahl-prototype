import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportArticleView } from "@/components/support/support-article";
import {
  getArticle,
  getPrevNext,
  supportArticles,
} from "@/lib/support-articles";

export const dynamicParams = false;

export function generateStaticParams() {
  return supportArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) return { title: "Article not found" };
  return {
    title: article.title.en,
    description: article.excerpt.en,
  };
}

export default async function SupportGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  if (!article) notFound();

  const { prev, next } = getPrevNext(slug);

  // Support tree: only curated guides (docs live under /docs)
  const tree = supportArticles;

  return <SupportArticleView article={article} prev={prev} next={next} tree={tree} />;
}
