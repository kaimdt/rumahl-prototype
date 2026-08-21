import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SupportArticleView } from "@/components/support/support-article";
import { getDoc, getDocPrevNext, docsArticles } from "@/lib/docs-data";
import { supportArticles } from "@/lib/support-articles";

export const dynamicParams = false;

export function generateStaticParams() {
  return docsArticles.map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getDoc(slug);
  if (!article) return { title: "Document not found" };
  return {
    title: article.title.en,
    description: article.excerpt.en,
  };
}

export default async function DocGuidePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getDoc(slug);
  if (!article) notFound();

  const { prev, next } = getDocPrevNext(slug);

  // Docs tree: only markdown documentation (no support guides)
  const tree = docsArticles;

  return <SupportArticleView article={article} prev={prev} next={next} tree={tree} />;
}
