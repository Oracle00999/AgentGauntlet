use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId, Gas, NearToken, PanicOnDefault, Promise};

const DAY_NS: u64 = 86_400_000_000_000;
// Conservative prepayment covers bounded vault and payment records. Excess stays
// in the storage reserve, never in spendable balances.
const VAULT_BYTES: u128 = 4096;
const PAYMENT_BYTES: u128 = 2048;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Vault {
    pub owner: AccountId,
    pub agent: AccountId,
    pub recipient: AccountId,
    pub available: U128,
    pub reserved: U128,
    pub storage_credit: U128,
    pub max_payment: U128,
    pub daily_limit: U128,
    pub day: u64,
    pub committed_today: U128,
    pub paused: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq)]
pub enum Status {
    Pending,
    Settled,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Payment {
    pub recipient: AccountId,
    pub amount: U128,
    pub day: u64,
    pub status: Status,
}

#[near(serializers = [json])]
pub struct Decision {
    pub accepted: bool,
    pub code: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    vaults: LookupMap<String, Vault>,
    payments: LookupMap<(String, String), Payment>,
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            vaults: LookupMap::new(b"v"),
            payments: LookupMap::new(b"p"),
        }
    }

    #[payable]
    pub fn create_vault(
        &mut self,
        vault_id: String,
        agent: AccountId,
        recipient: AccountId,
        max_payment: U128,
        daily_limit: U128,
    ) {
        assert!(
            !vault_id.is_empty() && vault_id.len() <= 64,
            "Invalid vault ID"
        );
        assert!(self.vaults.get(&vault_id).is_none(), "Vault exists");
        assert!(
            max_payment.0 > 0 && daily_limit.0 >= max_payment.0,
            "Invalid limits"
        );
        let fee = VAULT_BYTES * env::storage_byte_cost().as_yoctonear();
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit >= fee, "Insufficient storage deposit");
        self.vaults.insert(
            &vault_id,
            &Vault {
                owner: env::predecessor_account_id(),
                agent,
                recipient,
                available: U128(0),
                reserved: U128(0),
                storage_credit: U128(deposit - fee),
                max_payment,
                daily_limit,
                day: env::block_timestamp() / DAY_NS,
                committed_today: U128(0),
                paused: false,
            },
        );
    }

    #[payable]
    pub fn deposit(&mut self, vault_id: String) {
        let mut v = self.owned(&vault_id);
        v.available.0 = v
            .available
            .0
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("Overflow");
        self.vaults.insert(&vault_id, &v);
    }

    #[payable]
    pub fn fund_storage(&mut self, vault_id: String) {
        let mut v = self.owned(&vault_id);
        v.storage_credit.0 = v
            .storage_credit
            .0
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("Overflow");
        self.vaults.insert(&vault_id, &v);
    }

    pub fn set_paused(&mut self, vault_id: String, paused: bool) {
        let mut v = self.owned(&vault_id);
        v.paused = paused;
        self.vaults.insert(&vault_id, &v);
    }

    pub fn request_payment(
        &mut self,
        vault_id: String,
        payment_id: String,
        recipient: AccountId,
        amount: U128,
    ) -> Decision {
        let mut v = self.vaults.get(&vault_id).expect("Unknown vault");
        let key = (vault_id.clone(), payment_id.clone());
        let day = env::block_timestamp() / DAY_NS;
        if v.day != day {
            v.day = day;
            v.committed_today = U128(0);
        }
        let storage_fee = PAYMENT_BYTES * env::storage_byte_cost().as_yoctonear();
        let code = if env::predecessor_account_id() != v.agent {
            "UNAUTHORIZED_AGENT"
        } else if v.paused {
            "PAUSED"
        } else if payment_id.is_empty() || payment_id.len() > 128 {
            "INVALID_PAYMENT_ID"
        } else if self.payments.get(&key).is_some() {
            "DUPLICATE_PAYMENT"
        } else if recipient != v.recipient {
            "RECIPIENT_NOT_ALLOWED"
        } else if amount.0 == 0 || amount.0 > v.max_payment.0 {
            "TRANSACTION_LIMIT"
        } else if amount.0 > v.daily_limit.0.saturating_sub(v.committed_today.0) {
            "DAILY_LIMIT"
        } else if amount.0 > v.available.0 {
            "INSUFFICIENT_BALANCE"
        } else if v.storage_credit.0 < storage_fee {
            "INSUFFICIENT_STORAGE"
        } else {
            "ACCEPTED"
        };
        let accepted = code == "ACCEPTED";
        if accepted {
            assert!(
                env::prepaid_gas().as_gas() >= Gas::from_tgas(40).as_gas(),
                "Attach at least 40 Tgas"
            );
            v.available.0 -= amount.0;
            v.reserved.0 += amount.0;
            v.committed_today.0 += amount.0;
            v.storage_credit.0 -= storage_fee;
            self.vaults.insert(&vault_id, &v);
            self.payments.insert(
                &key,
                &Payment {
                    recipient: recipient.clone(),
                    amount,
                    day,
                    status: Status::Pending,
                },
            );
            Promise::new(recipient)
                .transfer(NearToken::from_yoctonear(amount.0))
                .then(
                    Self::ext(env::current_account_id())
                        .with_static_gas(Gas::from_tgas(15))
                        .finalize_payment(vault_id.clone(), payment_id.clone()),
                )
                .detach();
        }
        Self::event(
            "payment_decision",
            near_sdk::serde_json::json!({"vault_id": vault_id, "payment_id": payment_id, "code": code}),
        );
        Decision {
            accepted,
            code: code.to_string(),
        }
    }

    #[private]
    pub fn finalize_payment(&mut self, vault_id: String, payment_id: String) {
        assert_eq!(env::promise_results_count(), 1, "Expected transfer result");
        let key = (vault_id.clone(), payment_id.clone());
        let mut p = self.payments.get(&key).expect("Unknown payment");
        assert_eq!(p.status, Status::Pending, "Already finalized");
        let mut v = self.vaults.get(&vault_id).expect("Unknown vault");
        v.reserved.0 -= p.amount.0;
        p.status = if env::promise_result_checked(0, 0).is_ok() {
            Status::Settled
        } else {
            v.available.0 += p.amount.0;
            // Refund only the original day's reservation; a late callback must
            // never decrement a newer day's counter.
            if v.day == p.day {
                v.committed_today.0 -= p.amount.0;
            }
            Status::Failed
        };
        self.vaults.insert(&vault_id, &v);
        self.payments.insert(&key, &p);
        Self::event(
            "payment_finalized",
            near_sdk::serde_json::json!({"vault_id": vault_id, "payment_id": payment_id, "status": p.status}),
        );
    }

    pub fn get_vault(&self, vault_id: String) -> Option<Vault> {
        self.vaults.get(&vault_id)
    }
    pub fn get_payment(&self, vault_id: String, payment_id: String) -> Option<Payment> {
        self.payments.get(&(vault_id, payment_id))
    }
}

impl Contract {
    fn owned(&self, id: &String) -> Vault {
        let v = self.vaults.get(id).expect("Unknown vault");
        assert_eq!(env::predecessor_account_id(), v.owner, "Owner only");
        v
    }
    fn event(name: &str, data: near_sdk::serde_json::Value) {
        env::log_str(&format!(
            "EVENT_JSON:{}",
            near_sdk::serde_json::json!({"standard":"agentgauntlet", "version":"1.0.0", "event":name, "data":[data]})
        ));
    }
}

#[cfg(test)]
mod tests;
