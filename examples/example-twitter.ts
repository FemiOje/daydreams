import { Core } from "../packages/core/src/core/core";
import { tweetSchema, TwitterClient } from "../packages/core/src/io/twitter";
import { RoomManager } from "../packages/core/src/core/room-manager";
import { ChromaVectorDB } from "../packages/core/src/core/vector-db";
import { Processor } from "../packages/core/src/core/processor";
import { LLMClient } from "../packages/core/src/core/llm-client";
import { env } from "../packages/core/src/core/env";
import { LogLevel } from "../packages/core/src/types";
import chalk from "chalk";
import { defaultCharacter } from "../packages/core/src/core/character";
import { JSONSchemaType } from "ajv";
import { Consciousness } from "../packages/core/src/core/consciousness";

async function main() {
  // Initialize core dependencies
  const vectorDb = new ChromaVectorDB("twitter_agent", {
    chromaUrl: "http://localhost:8000",
    logLevel: LogLevel.DEBUG,
  });

  const roomManager = new RoomManager(vectorDb);

  const llmClient = new LLMClient({
    provider: "anthropic",
    apiKey: env.ANTHROPIC_API_KEY,
  });

  // Initialize processor with character definition
  const processor = new Processor(
    vectorDb,
    llmClient,
    defaultCharacter,
    LogLevel.DEBUG
  );

  // Initialize core
  const core = new Core(roomManager, vectorDb, processor, {
    logging: {
      level: LogLevel.DEBUG,
      enableColors: true,
      enableTimestamp: true,
    },
  });

  // Initialize Twitter client
  const twitter = new TwitterClient(
    {
      username: env.TWITTER_USERNAME,
      password: env.TWITTER_PASSWORD,
      email: env.TWITTER_EMAIL,
    },
    LogLevel.DEBUG
  );

  // Register Twitter inputs
  core.registerInput({
    name: "twitter_mentions",
    handler: async () => {
      console.log(chalk.blue("🔍 Checking Twitter mentions..."));
      const mentions = await twitter.createMentionsInput(60000).handler();

      // The processor will analyze these mentions and may suggest replies
      return mentions;
    },
    response: {
      type: "string",
      content: "string",
      metadata: "object",
    },
    interval: 60000,
  });

  //   // Monitor specific Twitter accounts
  //   const accountsToMonitor = ["elonmusk", "sama", "naval"];

  //   for (const account of accountsToMonitor) {
  //     core.registerInput({
  //       name: `twitter_timeline_${account}`,
  //       handler: async () => {
  //         console.log(chalk.blue(`📱 Checking ${account}'s timeline...`));
  //         return twitter.createTimelineInput(account, 300000).handler();
  //       },
  //       response: {
  //         type: "string",
  //         content: "string",
  //         metadata: "object",
  //       },
  //       interval: 300000, // Check timelines every 5 minutes
  //     });
  //   }

  // Initialize consciousness
  const consciousness = new Consciousness(llmClient, roomManager, {
    intervalMs: 300000, // Think every 5 minutes
    minConfidence: 0.7,
    logLevel: LogLevel.DEBUG,
  });

  // Register consciousness input
  core.registerInput({
    name: "consciousness_thoughts",
    handler: async () => {
      console.log(chalk.blue("🧠 Generating thoughts..."));
      const thought = await consciousness.start();

      // Only return thought if it's not an error and has sufficient confidence
      if (thought.type !== "error" && thought.type !== "low_confidence") {
        // If it's a social_share type thought, format it for Twitter
        if (thought.metadata?.type === "social_share") {
          return {
            type: "thought",
            content: thought.content,
            metadata: {
              ...thought.metadata,
              suggestedPlatform: "twitter",
              thoughtType: "social_share",
            },
          };
        }
      }
      return null;
    },
    response: {
      type: "string",
      content: "string",
      metadata: "object",
    },
    interval: 300000, // Check for new thoughts every 5 minutes
  });

  // Register Twitter output for thoughts
  core.registerOutput({
    name: "twitter_thought",
    handler: async (data: unknown) => {
      const thoughtData = data as { content: string };
      return twitter.createTweetOutput().handler({
        content: thoughtData.content,
      });
    },
    response: {
      success: "boolean",
      tweetId: "string",
    },
    schema: {
      type: "object" as const,
      properties: {
        content: { type: "string" as const, nullable: false },
      },
      required: ["content"],
      additionalProperties: false,
    } as any,
  });

  // Register Twitter output for auto-replies
  core.registerOutput({
    name: "twitter_reply",
    handler: async (data: unknown) => {
      const tweetData = data as { content: string; inReplyTo: string };
      return twitter.createTweetOutput().handler(tweetData);
    },
    response: {
      success: "boolean",
      tweetId: "string",
    },
    schema: {
      type: "object" as const,
      properties: {
        content: { type: "string" as const, nullable: false },
        inReplyTo: { type: "string" as const, nullable: false },
      },
      required: ["content", "inReplyTo"],
      additionalProperties: false,
    } as any,
  });

  // Keep the process running
  console.log(chalk.cyan("🤖 Bot is now running and monitoring Twitter..."));
  console.log(chalk.cyan("Press Ctrl+C to stop"));

  // Handle shutdown gracefully
  process.on("SIGINT", async () => {
    console.log(chalk.yellow("\n\nShutting down..."));

    // Stop consciousness
    await consciousness.stop();

    // Remove all inputs and outputs
    core.removeInput("twitter_mentions");
    core.removeInput("consciousness_thoughts");
    core.removeOutput("twitter_reply");
    core.removeOutput("twitter_thought");

    console.log(chalk.green("✅ Shutdown complete"));
    process.exit(0);
  });
}

// Run the example
main().catch((error) => {
  console.error(chalk.red("Fatal error:"), error);
  process.exit(1);
});