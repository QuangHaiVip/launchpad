#![cfg(test)]

use super::{Error, Launchpad, LaunchpadClient, Status};
use receipt_token::{ReceiptToken, ReceiptTokenClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

struct Ctx<'a> {
    env: Env,
    pad: LaunchpadClient<'a>,
    token: ReceiptTokenClient<'a>,
}

const SOFT_CAP: i128 = 100_000_000;
const HARD_CAP: i128 = 1_000_000_000;
const PRICE: i128 = 100;
const DEADLINE: u64 = 86_400;

fn setup<'a>() -> Ctx<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let creator = Address::generate(&env);
    let placeholder = Address::generate(&env);
    let token_id = env.register(ReceiptToken, (placeholder,));

    let pad_id = env.register(
        Launchpad,
        (
            creator,
            token_id.clone(),
            PRICE,
            SOFT_CAP,
            HARD_CAP,
            DEADLINE,
        ),
    );

    let token = ReceiptTokenClient::new(&env, &token_id);
    token.set_admin(&pad_id);

    Ctx {
        pad: LaunchpadClient::new(&env, &pad_id),
        token,
        env,
    }
}

fn advance(env: &Env, seconds: u64) {
    env.ledger().with_mut(|li| {
        li.timestamp = li.timestamp.saturating_add(seconds);
    });
}

#[test]
fn pledge_records_buyer_amount() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);

    ctx.pad.pledge(&alice, &50_000_000);
    assert_eq!(ctx.pad.pledged_of(&alice), 50_000_000);
    let (total, _, _, _, status) = ctx.pad.sale_state();
    assert_eq!(total, 50_000_000);
    assert_eq!(status, Status::Active);
}

#[test]
fn pledge_after_deadline_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    advance(&ctx.env, DEADLINE + 1);
    let r = ctx.pad.try_pledge(&alice, &10_000_000);
    assert!(matches!(r, Err(Ok(Error::SaleClosed))));
}

#[test]
fn pledge_over_hard_cap_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    let r = ctx.pad.try_pledge(&alice, &(HARD_CAP + 1));
    assert!(matches!(r, Err(Ok(Error::HardCapExceeded))));
}

#[test]
fn finalize_with_soft_cap_met_marks_successful() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    ctx.pad.pledge(&alice, &SOFT_CAP);

    advance(&ctx.env, DEADLINE);
    let new_status = ctx.pad.finalize();
    assert_eq!(new_status, Status::Successful);
}

#[test]
fn finalize_below_soft_cap_marks_failed() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    ctx.pad.pledge(&alice, &(SOFT_CAP / 2));

    advance(&ctx.env, DEADLINE);
    let new_status = ctx.pad.finalize();
    assert_eq!(new_status, Status::Failed);
}

#[test]
fn claim_after_success_mints_proportional_tokens() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    ctx.pad.pledge(&alice, &SOFT_CAP);

    advance(&ctx.env, DEADLINE);
    ctx.pad.finalize();

    let tokens = ctx.pad.claim(&alice);
    assert_eq!(tokens, SOFT_CAP * PRICE / 10_000_000);
    assert_eq!(ctx.token.balance(&alice), tokens);
}

#[test]
fn refund_after_failure_returns_amount() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    ctx.pad.pledge(&alice, &(SOFT_CAP / 2));

    advance(&ctx.env, DEADLINE);
    ctx.pad.finalize();

    let refunded = ctx.pad.refund(&alice);
    assert_eq!(refunded, SOFT_CAP / 2);
    assert_eq!(ctx.pad.pledged_of(&alice), 0);
}

#[test]
fn double_claim_blocked() {
    let ctx = setup();
    let alice = Address::generate(&ctx.env);
    ctx.pad.pledge(&alice, &SOFT_CAP);
    advance(&ctx.env, DEADLINE);
    ctx.pad.finalize();
    ctx.pad.claim(&alice);

    let r = ctx.pad.try_claim(&alice);
    assert!(matches!(r, Err(Ok(Error::AlreadyClaimed))));
}
