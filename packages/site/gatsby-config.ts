import type { GatsbyConfig } from "gatsby";

/**
 * Set GATSBY_SITE_URL in the Amplify branch environment so canonical URLs
 * point at the right host per environment.
 *
 * There is no sitemap or robots plugin here, and that is deliberate: every
 * route sits behind Cognito, so there is nothing for a crawler to index.
 */
const siteUrl = process.env.GATSBY_SITE_URL || "https://blueprinting.dlab5.net";

const config: GatsbyConfig = {
  siteMetadata: {
    title: "D-LAB-5 Blueprinting",
    description:
      "Engineering governance and architecture planning over an ArchiMate 3.2 semantic model.",
    siteUrl,
  },
  graphqlTypegen: true,
  plugins: [],
};

export default config;
