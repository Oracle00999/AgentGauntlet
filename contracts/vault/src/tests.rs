use super::*;
use near_sdk::{
    test_utils::{accounts, VMContextBuilder},
    testing_env, PromiseResult,
};

fn context(who: usize, deposit: u128, day: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(who))
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(100))
        .block_timestamp(day * DAY_NS)
        .build());
}
fn fixture() -> Contract {
    context(1, 10u128.pow(23), 1);
    let mut c = Contract::new();
    c.create_vault("v".into(), accounts(2), accounts(3), U128(25), U128(50));
    context(1, 100, 1);
    c.deposit("v".into());
    context(2, 0, 1);
    c
}
fn pay(c: &mut Contract, id: &str, recipient: usize, amount: u128) -> Decision {
    c.request_payment("v".into(), id.into(), accounts(recipient), U128(amount))
}
fn finish(c: &mut Contract, id: &str, result: PromiseResult, day: u64) {
    let ctx = VMContextBuilder::new()
        .current_account_id(accounts(0))
        .predecessor_account_id(accounts(0))
        .block_timestamp(day * DAY_NS)
        .build();
    testing_env!(
        ctx,
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
    c.finalize_payment("v".into(), id.into());
}
#[test]
fn restrictions_do_not_move_funds() {
    let mut c = fixture();
    assert_eq!(pay(&mut c, "bad", 4, 10).code, "RECIPIENT_NOT_ALLOWED");
    assert_eq!(pay(&mut c, "big", 3, 26).code, "TRANSACTION_LIMIT");
    context(4, 0, 1);
    assert_eq!(pay(&mut c, "other", 3, 10).code, "UNAUTHORIZED_AGENT");
    assert_eq!(c.get_vault("v".into()).unwrap().available.0, 100);
}
#[test]
fn pending_reservations_prevent_concurrent_overspend_and_replay() {
    let mut c = fixture();
    assert!(pay(&mut c, "one", 3, 25).accepted);
    assert_eq!(pay(&mut c, "one", 3, 25).code, "DUPLICATE_PAYMENT");
    assert!(pay(&mut c, "two", 3, 25).accepted);
    assert_eq!(pay(&mut c, "three", 3, 1).code, "DAILY_LIMIT");
    let v = c.get_vault("v".into()).unwrap();
    assert_eq!(
        (v.available.0, v.reserved.0, v.committed_today.0),
        (50, 50, 50)
    );
}
#[test]
fn settlement_and_failure_accounting() {
    let mut c = fixture();
    pay(&mut c, "ok", 3, 20);
    finish(&mut c, "ok", PromiseResult::Successful(vec![]), 1);
    assert_eq!(
        c.get_payment("v".into(), "ok".into()).unwrap().status,
        Status::Settled
    );
    context(2, 0, 1);
    pay(&mut c, "fail", 3, 20);
    finish(&mut c, "fail", PromiseResult::Failed, 1);
    let v = c.get_vault("v".into()).unwrap();
    assert_eq!(
        (v.available.0, v.reserved.0, v.committed_today.0),
        (80, 0, 20)
    );
    context(2, 0, 1);
    assert_eq!(pay(&mut c, "fail", 3, 20).code, "DUPLICATE_PAYMENT");
}
#[test]
fn late_failure_does_not_refund_new_day_budget() {
    let mut c = fixture();
    pay(&mut c, "old", 3, 20);
    context(2, 0, 2);
    pay(&mut c, "new", 3, 25);
    finish(&mut c, "old", PromiseResult::Failed, 2);
    assert_eq!(c.get_vault("v".into()).unwrap().committed_today.0, 25);
}
#[test]
fn owner_can_pause() {
    let mut c = fixture();
    context(1, 0, 1);
    c.set_paused("v".into(), true);
    context(2, 0, 1);
    assert_eq!(pay(&mut c, "x", 3, 10).code, "PAUSED");
}
#[test]
#[should_panic(expected = "Owner only")]
fn agent_cannot_change_pause() {
    let mut c = fixture();
    c.set_paused("v".into(), true);
}
#[test]
fn vaults_are_isolated() {
    let mut c = fixture();
    context(4, 10u128.pow(23), 1);
    c.create_vault("other".into(), accounts(2), accounts(3), U128(25), U128(50));
    context(2, 0, 1);
    assert_eq!(
        c.request_payment("other".into(), "x".into(), accounts(3), U128(10))
            .code,
        "INSUFFICIENT_BALANCE"
    );
    assert_eq!(c.get_vault("v".into()).unwrap().available.0, 100);
}
