import * as anchor from "@project-serum/anchor";
import randombytes from "randombytes";
import { expect } from "chai";
import { GplCore } from "../../target/types/gpl_core";
import { airdrop, new_session } from "../utils";
import { sendAndConfirmTransaction } from "@solana/web3.js";

const program = anchor.workspace.GplCore as anchor.Program<GplCore>;

anchor.setProvider(anchor.AnchorProvider.env());

const provider = anchor.getProvider();

describe("Post", async () => {
  let userPDA: anchor.web3.PublicKey;
  let profilePDA: anchor.web3.PublicKey;
  let postPDA: anchor.web3.PublicKey;
  let feePayer: anchor.web3.Keypair;

  before(async () => {
    // Create a user
    const randomHash = randombytes(32);
    const userTx = program.methods.createUser(randomHash);
    const userPubKeys = await userTx.pubkeys();
    userPDA = userPubKeys.user as anchor.web3.PublicKey;
    await userTx.rpc();

    // Create a profile
    const profileTx = program.methods
      .createProfile("Personal")
      .accounts({ user: userPDA });
    const profilePubKeys = await profileTx.pubkeys();
    profilePDA = profilePubKeys.profile as anchor.web3.PublicKey;
    await profileTx.rpc();

    // Create fee payer keypair
    feePayer = anchor.web3.Keypair.generate();
    await airdrop(feePayer.publicKey);
  });

  it("should create a post", async () => {
    const randomHash = randombytes(32);
    const metadataUri = "This is a test post";
    const post = program.methods
      .createPost(metadataUri, randomHash)
      .accounts({ user: userPDA, profile: profilePDA, sessionToken: null });
    const postPubKeys = await post.pubkeys();
    postPDA = postPubKeys.post as anchor.web3.PublicKey;
    await post.rpc();
    const postAccount = await program.account.post.fetch(postPDA);
    expect(postAccount.metadataUri).is.equal(metadataUri);
    expect(postAccount.profile.toString()).is.equal(profilePDA.toString());
  });

  it("should update a post", async () => {
    const metadataUri = "This is an updated test post";
    const post = program.methods.updatePost(metadataUri).accounts({
      user: userPDA,
      profile: profilePDA,
      post: postPDA,
      sessionToken: null,
    });
    await post.rpc();
    const postAccount = await program.account.post.fetch(postPDA);
    expect(postAccount.metadataUri).is.equal(metadataUri);
    expect(postAccount.profile.toString()).is.equal(profilePDA.toString());
  });

  it("should delete a post", async () => {
    const post = program.methods.deletePost().accounts({
      user: userPDA,
      profile: profilePDA,
      post: postPDA,
      sessionToken: null,
      refundReceiver: provider.wallet.publicKey,
    });
    await post.rpc();
    try {
      await program.account.post.fetch(postPDA);
    } catch (error: any) {
      expect(error).to.be.an("error");
      expect(error.toString()).to.contain(
        `Account does not exist or has no data ${postPDA.toString()}`
      );
    }
  });

  it("should create a post when a seperate fee payer is specified", async () => {
    const randomHash = randombytes(32);
    const metadataUri = "This is a test post";
    const createPost = program.methods
      .createPost(metadataUri, randomHash)
      .accounts({ payer: feePayer.publicKey, user: userPDA, profile: profilePDA, sessionToken: null });
    const pubKeys = await createPost.pubkeys();
    postPDA = pubKeys.post as anchor.web3.PublicKey;
    await createPost.signers([feePayer]).rpc();
    const postAccount = await program.account.post.fetch(postPDA);
    expect(postAccount.metadataUri).is.equal(metadataUri);
    expect(postAccount.profile.toString()).is.equal(profilePDA.toString());
  });

  describe("Post with session token", async () => {
    let rpcConnection: anchor.web3.Connection;
    let sessionToken: anchor.web3.PublicKey;
    let sessionKeypair: anchor.web3.Keypair;
    let randomUser: anchor.web3.Keypair;
    let randomUserWallet: anchor.Wallet;
    let randomUserPDA: anchor.web3.PublicKey;
    let randomProfilePDA: anchor.web3.PublicKey;
    let randomPostPDA: anchor.web3.PublicKey;

    before(async () => {
      rpcConnection = new anchor.web3.Connection(
        "http://localhost:8899",
        "confirmed"
      );
      // Create a random user
      randomUser = anchor.web3.Keypair.generate();
      randomUserWallet = new anchor.Wallet(randomUser);
      await airdrop(randomUser.publicKey);

      // Create a user
      const randomHash = randombytes(32);
      const userTx = program.methods
        .createUser(randomHash)
        .accounts({ payer: randomUser.publicKey, authority: randomUser.publicKey });
      const userPubKeys = await userTx.pubkeys();
      randomUserPDA = userPubKeys.user;
      const tx = await userTx.transaction();
      tx.recentBlockhash = (await rpcConnection.getRecentBlockhash()).blockhash;
      tx.feePayer = randomUser.publicKey;
      const signedTestUserTransaction = await randomUserWallet.signTransaction(
        tx
      );
      await sendAndConfirmTransaction(
        rpcConnection,
        signedTestUserTransaction,
        [randomUser]
      );

      // Create a profile
      const testProfile = program.methods
        .createProfile("Personal")
        .accounts({ payer: randomUser.publicKey, user: randomUserPDA, authority: randomUser.publicKey });
      const testProfilePubKeys = await testProfile.pubkeys();
      randomProfilePDA = testProfilePubKeys.profile as anchor.web3.PublicKey;
      const testProfileTx = await testProfile.transaction();
      testProfileTx.recentBlockhash = (
        await rpcConnection.getLatestBlockhash()
      ).blockhash;
      testProfileTx.feePayer = randomUser.publicKey;
      const signedTransaction = await randomUserWallet.signTransaction(
        testProfileTx
      );
      await sendAndConfirmTransaction(rpcConnection, signedTransaction, [
        randomUser,
      ]);

      // Create a session
      // @ts-ignore
      const { sessionPDA, sessionSigner } = await new_session(
        provider.publicKey,
        program.programId
      );
      sessionToken = sessionPDA;
      sessionKeypair = sessionSigner;
    });

    it("should create a post", async () => {
      const randomHash = randombytes(32);
      const metadataUri = "This is a test post";
      const post = program.methods
        .createPost(metadataUri, randomHash)
        .accounts({
          user: userPDA,
          profile: profilePDA,
          sessionToken: sessionToken,
          authority: sessionKeypair.publicKey,
        });
      const postPubKeys = await post.pubkeys();
      postPDA = postPubKeys.post as anchor.web3.PublicKey;
      await post.signers([sessionKeypair]).rpc();
      const postAccount = await program.account.post.fetch(postPDA);
      expect(postAccount.metadataUri).is.equal(metadataUri);
      expect(postAccount.profile.toString()).is.equal(profilePDA.toString());
    });

    it("should not create a post with sessionToken created by wrong authority", async () => {
      const randomHash = randombytes(32);
      const metadataUri = "This is a test post";
      const post = program.methods
        .createPost(metadataUri, randomHash)
        .accounts({
          user: randomUserPDA,
          profile: randomProfilePDA,
          sessionToken: sessionToken,
          authority: randomUser.publicKey,
        });
      const postPubKeys = await post.pubkeys();
      randomPostPDA = postPubKeys.post as anchor.web3.PublicKey;
      try {
        await post.signers([randomUser]).rpc();
      } catch (error: any) {
        expect(error).to.be.an("error");
        expect(error.toString()).to.contain("Error Code: InvalidToken");
      }
    });

    it("should not create a post with wrong authority", async () => {
      const randomHash = randombytes(32);
      const metadataUri = "This is a test post";
      const post = program.methods
        .createPost(metadataUri, randomHash)
        .accounts({
          user: randomUserPDA,
          profile: randomProfilePDA,
          sessionToken: sessionToken,
          authority: randomUser.publicKey,
        });
      const postPubKeys = await post.pubkeys();
      randomPostPDA = postPubKeys.post as anchor.web3.PublicKey;
      try {
        await post.signers([sessionKeypair]).rpc();
      } catch (error: any) {
        expect(error).to.be.an("error");
        expect(error.toString()).to.contain("Error: unknown signer");
      }
    });

    it("should update a post", async () => {
      const metadataUri = "This is an updated test post";
      const post = program.methods.updatePost(metadataUri).accounts({
        user: userPDA,
        profile: profilePDA,
        post: postPDA,
        sessionToken: sessionToken,
        authority: sessionKeypair.publicKey,
      });
      await post.signers([sessionKeypair]).rpc();
      const postAccount = await program.account.post.fetch(postPDA);
      expect(postAccount.metadataUri).is.equal(metadataUri);
      expect(postAccount.profile.toString()).is.equal(profilePDA.toString());
    });

    it("should delete a post", async () => {
      const post = program.methods.deletePost().accounts({
        user: userPDA,
        profile: profilePDA,
        post: postPDA,
        sessionToken: sessionToken,
        authority: sessionKeypair.publicKey,
        refundReceiver: provider.wallet.publicKey,
      });
      await post.signers([sessionKeypair]).rpc();
      try {
        await program.account.post.fetch(postPDA);
      } catch (error: any) {
        expect(error).to.be.an("error");
        expect(error.toString()).to.contain(
          `Account does not exist or has no data ${postPDA.toString()}`
        );
      }
    });
  });
});
