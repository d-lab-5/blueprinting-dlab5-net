# ADR-0015 — Code open, instance closed

- Status: accepted
- Date: 2026-11-08

## Context

Most D-LAB-5 and DigitalHome.Cloud repositories are public, and Amplify Gen 2
deploys several of them straight from a branch. In Gen 2 the backend is code:
`backend.ts` decides whether a bucket blocks public access, which identities
exist, and what every Lambda allows. Whatever reaches a deployed branch is
applied with the Amplify service role, and CDK's CloudFormation execution role
defaults to `AdministratorAccess`.

So a public repository is not by itself the risk. Nobody can deploy by reading
code, and a fork's pull request triggers nothing while PR previews stay off.
The risk is **a commit reaching a deployed branch that its owner did not
intend**. That can come from:

- a stolen token, SSH key or OAuth grant: two-factor sign-in protects the
  session, not these;
- a compromised dependency whose install script runs in the build;
- an honest mistake by a person or an agent that pushes.

Any of these can remove one `blockPublicAccess` line, add a public bucket
policy, or widen a check in an access Lambda. The last is the quiet one: it
leaves S3 private and still hands out every pre-signed URL.

## Decision

**The code is public; the controls that keep an instance closed must not
depend on the code staying honest.** Each layer below holds even when the one
above it fails.

1. **The repository says what it wants, and says it loudly.** Security
   settings are explicit in the code (`BLOCK_ALL`, no guest identities, no
   self-signup; `SECURITY.md` → *Design invariants*). A change to one of them is
   a visible diff, not the absence of a line.
2. **Only a reviewed branch deploys production.** GitHub rulesets, with no
   bypass actors, on every public repository that deploys or publishes:
   - `main`: changes only by pull request, merge commits only, no force push,
     no deletion, and the repository's CI check where it has one;
   - `stage`: no force push and no deletion, so integration history cannot be
     rewritten under a running build.

   Production auto-builds from `main`. Where a production app still builds
   from `stage`, moving it to `main` is the follow-up this decision commits to.
3. **Secrets are stopped before they land.** Secret scanning with push
   protection is on for every public repository.
4. **The account refuses what no deploy may do.** These are set in AWS, never
   from a repository:
   - S3 Block Public Access at account level;
   - a CloudFormation execution policy narrower than `AdministratorAccess`,
     with an explicit deny on public-access and bucket-policy changes;
   - one service role per Amplify app, so one app's build cannot deploy into
     another's stacks.
5. **What slips through is noticed.** IAM Access Analyzer reports any bucket
   that becomes public or shared. After each deploy, a live check confirms:
   - an unsigned object URL returns 403;
   - a non-member gets no pre-signed URL.

   This is the `verify:*` pattern; `verify:model-store` already does the
   second check here.

**Private repositories** on a free plan cannot use rulesets. They rely on
layers 4 and 5, and on production branches that do not auto-build. Making the
source public is an acceptable way to get layer 2 free, since the code was
meant to be open.

## Consequences

- **A direct push to `main` is refused, for agents and for the owner alike.**
  Promotion is the `stage` → `main` pull request this repository already used;
  the repositories that committed to `main` directly now go through one too.
  With one maintainer the review count is zero. The rule buys a deliberate,
  visible step and a CI run, not a second pair of eyes.
- **Nobody bypasses a ruleset.** An emergency fix still needs a pull request.
  An administrator can switch a ruleset off, so a token without the
  Administration permission (a fine-grained one) is worth more than one with
  it.
- **Squash and rebase merges are off on `main`.** They would make `main` and
  `stage` diverge after every promotion.
- **Layer 4 cannot be checked from the repository.** Nothing in CI proves the
  account settings exist. The security audit records them, outside any public
  repository, because a list of which layers are still missing is not
  something to publish.
- **A deploy with administrator rights can still undo account settings,**
  except a Service Control Policy. If the accounts move into AWS
  Organizations, the layer 4 denies belong in an SCP.
- **This ADR is about the deploy path, not the app's authorization.** ADR-0002
  and ADR-0003 remain what decides who can read a model. This decision only
  keeps a commit from silently rewriting them.
