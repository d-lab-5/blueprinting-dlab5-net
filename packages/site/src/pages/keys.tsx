import * as React from "react";
import type { HeadFC } from "gatsby";
import { Shell } from "../components/Shell";
import { ApiKeys } from "../components/ApiKeys";

/**
 * API keys, which belong to a person rather than to a product.
 *
 * Its own page rather than a panel inside a product, because a key is not
 * scoped to one: it carries its owner's groups and therefore reaches every
 * product they can reach. Putting it under a product would say otherwise.
 */
const KeysPage: React.FC = () => (
  <Shell>
    <h1>API keys</h1>
    <ApiKeys />
  </Shell>
);

export default KeysPage;

export const Head: HeadFC = () => <title>API keys · blueprinting.dlab5</title>;
