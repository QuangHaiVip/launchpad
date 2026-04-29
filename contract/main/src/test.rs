#![cfg(test)]

use super::{Error, Launchpad, LaunchpadClient, Status};
use receipt_token::{ReceiptToken, ReceiptTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

struct Ctx<'a> {
    env: Env,
    pad: LaunchpadClient<'a>,
    pad_id: Address,
    token: ReceiptTokenClient<'a>,
    xlm: token::Client<'a>,
    xlm_admin: token::StellarAssetClient<'a>,
    creator: Address,
    id: u64,
}

const SOFT_CAP: i128 = 100_000_000;
const HARD_CAP: i128 = 1_000_000_000;
const PRICE: i128 = 100;
const DEADLINE_OFFSET: u64 = 86_400;
const FUND: i128 = 5_000_000_000;

fn setup<'a>() -> Ctx<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|li| {
        li.timestamp = 1_000;
    });

    let placeholder = Address::generate(&env);
    let token_id = env.register(ReceiptToken, (placeholder,));

    let sac_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(sac_admin);
    let native_id = sac.address();

    let pad_id = env.register(Launchpad, (token_id.clone(), native_id.clone()));

    let token = ReceiptTokenClient::new(&env, &token_id);
    token.set_admin(&pad_id);

    let xlm = token::Client::new(&env, &native_id);
    let xlm_admin = token::StellarAssetClient::new(&env, &native_id);

    let pad = LaunchpadClient::new(&env, &pad_id);
    let creator = Address::generate(&env);
    let now = env.ledger().timestamp();
    let id = pad.create_campaign(
        &creator,
        &PRICE,
        &SOFT_CAP,
        &HARD_CAP,
        &(now + DEADLINE_OFFSET),
    );

    Ctx {
        pad,
        pad_id,
        token,
        xlm,
        xlm_admin,
        env,
        creator,
        id,
    }
}

fn fund(ctx: &Ctx, who: &Address, amount: i128) {
    ctx.xlm_admin.mint(who, &amount);
}

fn advance(env: &Env, seconds: u64) {
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp.saturating_add(seconds);
    });
}

#[test]
fn create_campaign_assigns_sequential_ids() {
    let ctx = setup();
    assert_eq!(ctx.id, 0);
    let now = ctx.env.ledger().timestamp();
    let id1 = ctx.pad.create_campaign(
        &ctx.creator,
        &PRICE,
        &SOFT_CAP,
        &HARD_CAP,
        &(now + DEADLINE_OFFSET),
    );
    assert_eq!(id1, 1);
    assert_eq!(ctx.pad.campaign_count(), 2);
}

#[test]
fn create_campaign_rejects_invalid_params() {
    let ctx = setup();
    let now = ctx.env.ledger().timestamp();
    let r = ctx.pad.try_create_campaign(
        &ctx.creator,
        &PRICE,
        &SOFT_CAP,
        &(SOFT_CAP - 1),
        &(now + DEADLINE_OFFSET),
    );
    assert!(matches!(r, Err(Ok(Error::InvalidParams))));
    let r = ctx.pad.try_create_campaign(&ctx.creator, &PRICE, &SOFT_CAP, &HARD_CAP, &now);
    assert!(matches!(r, Err(Ok(Error::InvalidParams))));
}

#[test]
fn pledge_records_buyer_amount_and_moves_xlm() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);

    ctx.pad.pledge(&alice, &ctx.id, &50_000_000);

    assert_eq!(ctx.pad.pledged_of(&ctx.id, &alice), 50_000_000);
    let camp = ctx.pad.campaign(&ctx.id).unwrap();
    assert_eq!(camp.total_raised, 50_000_000);
    assert_eq!(camp.status, Status::Active);
    assert_eq!(ctx.xlm.balance(&alice), FUND - 50_000_000);
    assert_eq!(ctx.xlm.balance(&ctx.pad_id), 50_000_000);
}

#[test]
fn pledge_against_unknown_campaign_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    let r = ctx.pad.try_pledge(&alice, &999, &10_000_000);
    assert!(matches!(r, Err(Ok(Error::CampaignNotFound))));
}

#[test]
fn pledge_after_deadline_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    advance(&ctx.env, DEADLINE_OFFSET + 1);
    let r = ctx.pad.try_pledge(&alice, &ctx.id, &10_000_000);
    assert!(matches!(r, Err(Ok(Error::SaleClosed))));
}

#[test]
fn pledge_over_hard_cap_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, HARD_CAP * 2);
    let r = ctx.pad.try_pledge(&alice, &ctx.id, &(HARD_CAP + 1));
    assert!(matches!(r, Err(Ok(Error::HardCapExceeded))));
}

#[test]
fn finalize_with_soft_cap_met_marks_successful() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    let new_status = ctx.pad.finalize(&ctx.id);
    assert_eq!(new_status, Status::Successful);
}

#[test]
fn finalize_below_soft_cap_marks_failed() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &(SOFT_CAP / 2));
    advance(&ctx.env, DEADLINE_OFFSET);
    let new_status = ctx.pad.finalize(&ctx.id);
    assert_eq!(new_status, Status::Failed);
}

#[test]
fn claim_after_success_mints_proportional_tokens() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);

    let tokens = ctx.pad.claim(&alice, &ctx.id);
    assert_eq!(tokens, SOFT_CAP * PRICE / 10_000_000);
    assert_eq!(ctx.token.balance(&alice), tokens);
}

#[test]
fn refund_after_failure_returns_xlm() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    let amount = SOFT_CAP / 2;
    ctx.pad.pledge(&alice, &ctx.id, &amount);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);

    let before = ctx.xlm.balance(&alice);
    let refunded = ctx.pad.refund(&alice, &ctx.id);

    assert_eq!(refunded, amount);
    assert_eq!(ctx.pad.pledged_of(&ctx.id, &alice), 0);
    assert_eq!(ctx.xlm.balance(&alice), before + amount);
    assert_eq!(ctx.xlm.balance(&ctx.pad_id), 0);
}

#[test]
fn double_claim_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);
    ctx.pad.claim(&alice, &ctx.id);
    let r = ctx.pad.try_claim(&alice, &ctx.id);
    assert!(matches!(r, Err(Ok(Error::AlreadyClaimed))));
}

#[test]
fn withdraw_after_success_pays_creator() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);

    let before = ctx.xlm.balance(&ctx.creator);
    let withdrawn = ctx.pad.withdraw(&ctx.creator, &ctx.id);

    assert_eq!(withdrawn, SOFT_CAP);
    assert_eq!(ctx.xlm.balance(&ctx.creator), before + SOFT_CAP);
    assert_eq!(ctx.xlm.balance(&ctx.pad_id), 0);
}

#[test]
fn withdraw_blocked_for_non_creator() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);

    let r = ctx.pad.try_withdraw(&alice, &ctx.id);
    assert!(matches!(r, Err(Ok(Error::NotCreator))));
}

#[test]
fn double_withdraw_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    advance(&ctx.env, DEADLINE_OFFSET);
    ctx.pad.finalize(&ctx.id);
    ctx.pad.withdraw(&ctx.creator, &ctx.id);
    let r = ctx.pad.try_withdraw(&ctx.creator, &ctx.id);
    assert!(matches!(r, Err(Ok(Error::AlreadyWithdrawn))));
}

#[test]
fn campaigns_are_independent() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let bob = Address::generate(&ctx.env);
    fund(&ctx, &alice, FUND);
    fund(&ctx, &bob, FUND);
    let creator2 = Address::generate(&ctx.env);
    let now = ctx.env.ledger().timestamp();
    let id2 = ctx.pad.create_campaign(
        &creator2,
        &PRICE,
        &SOFT_CAP,
        &HARD_CAP,
        &(now + DEADLINE_OFFSET),
    );

    ctx.pad.pledge(&alice, &ctx.id, &SOFT_CAP);
    ctx.pad.pledge(&bob, &id2, &(SOFT_CAP / 2));

    advance(&ctx.env, DEADLINE_OFFSET);
    assert_eq!(ctx.pad.finalize(&ctx.id), Status::Successful);
    assert_eq!(ctx.pad.finalize(&id2), Status::Failed);

    ctx.pad.claim(&alice, &ctx.id);
    let refunded = ctx.pad.refund(&bob, &id2);
    assert_eq!(refunded, SOFT_CAP / 2);

    assert_eq!(ctx.pad.pledged_of(&ctx.id, &bob), 0);
    assert_eq!(ctx.pad.pledged_of(&id2, &alice), 0);
}
