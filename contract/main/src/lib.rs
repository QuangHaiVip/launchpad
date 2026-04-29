#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    symbol_short, Address, Env,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    AmountMustBePositive = 2,
    SaleClosed = 3,
    SaleStillOpen = 4,
    SoftCapNotMet = 5,
    SoftCapMet = 6,
    HardCapExceeded = 7,
    NoPledge = 8,
    AlreadyClaimed = 9,
}

#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Status {
    Active = 0,
    Successful = 1,
    Failed = 2,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Creator,
    PriceTokensPerXlm,
    SoftCap,
    HardCap,
    Deadline,
    TotalRaised,
    Status,
    Pledged(Address),
    Claimed(Address),
}

#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn mint(env: Env, to: Address, amount: i128);
}

#[contract]
pub struct Launchpad;

#[contractimpl]
impl Launchpad {
    pub fn __constructor(
        env: Env,
        creator: Address,
        token: Address,
        price_tokens_per_xlm: i128,
        soft_cap: i128,
        hard_cap: i128,
        deadline: u64,
    ) {
        env.storage().instance().set(&DataKey::Creator, &creator);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage()
            .instance()
            .set(&DataKey::PriceTokensPerXlm, &price_tokens_per_xlm);
        env.storage().instance().set(&DataKey::SoftCap, &soft_cap);
        env.storage().instance().set(&DataKey::HardCap, &hard_cap);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage().instance().set(&DataKey::TotalRaised, &0_i128);
        env.storage().instance().set(&DataKey::Status, &Status::Active);
    }

    pub fn pledge(env: Env, buyer: Address, amount: i128) -> Result<(), Error> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        let status: Status = env
            .storage()
            .instance()
            .get(&DataKey::Status)
            .ok_or(Error::NotInitialized)?;
        if status != Status::Active {
            return Err(Error::SaleClosed);
        }
        let deadline: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Deadline)
            .ok_or(Error::NotInitialized)?;
        if env.ledger().timestamp() >= deadline {
            return Err(Error::SaleClosed);
        }
        let hard_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HardCap)
            .ok_or(Error::NotInitialized)?;
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);
        if total + amount > hard_cap {
            return Err(Error::HardCapExceeded);
        }

        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(buyer.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Pledged(buyer.clone()), &(prev + amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalRaised, &(total + amount));

        env.events()
            .publish((symbol_short!("pledge"), buyer), amount);
        Ok(())
    }

    pub fn finalize(env: Env) -> Result<Status, Error> {
        let status: Status = env
            .storage()
            .instance()
            .get(&DataKey::Status)
            .ok_or(Error::NotInitialized)?;
        if status != Status::Active {
            return Err(Error::SaleClosed);
        }
        let deadline: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Deadline)
            .ok_or(Error::NotInitialized)?;
        if env.ledger().timestamp() < deadline {
            return Err(Error::SaleStillOpen);
        }
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);
        let soft_cap: i128 = env
            .storage()
            .instance()
            .get(&DataKey::SoftCap)
            .ok_or(Error::NotInitialized)?;

        let new_status = if total >= soft_cap {
            Status::Successful
        } else {
            Status::Failed
        };
        env.storage().instance().set(&DataKey::Status, &new_status);
        env.events()
            .publish((symbol_short!("finalize"),), (total, new_status as u32));
        Ok(new_status)
    }

    pub fn claim(env: Env, buyer: Address) -> Result<i128, Error> {
        buyer.require_auth();
        let status: Status = env
            .storage()
            .instance()
            .get(&DataKey::Status)
            .ok_or(Error::NotInitialized)?;
        if status != Status::Successful {
            return Err(Error::SoftCapNotMet);
        }
        let pledged: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(buyer.clone()))
            .ok_or(Error::NoPledge)?;
        if pledged <= 0 {
            return Err(Error::NoPledge);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Claimed(buyer.clone()))
        {
            return Err(Error::AlreadyClaimed);
        }

        let price: i128 = env
            .storage()
            .instance()
            .get(&DataKey::PriceTokensPerXlm)
            .ok_or(Error::NotInitialized)?;
        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let tokens = pledged * price / 10_000_000;

        let token = TokenClient::new(&env, &token_addr);
        token.mint(&buyer, &tokens);

        env.storage()
            .persistent()
            .set(&DataKey::Claimed(buyer.clone()), &true);
        env.events()
            .publish((symbol_short!("claim"), buyer), (pledged, tokens));
        Ok(tokens)
    }

    pub fn refund(env: Env, buyer: Address) -> Result<i128, Error> {
        buyer.require_auth();
        let status: Status = env
            .storage()
            .instance()
            .get(&DataKey::Status)
            .ok_or(Error::NotInitialized)?;
        if status != Status::Failed {
            return Err(Error::SoftCapMet);
        }
        let pledged: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(buyer.clone()))
            .ok_or(Error::NoPledge)?;
        if pledged <= 0 {
            return Err(Error::NoPledge);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pledged(buyer.clone()), &0_i128);
        env.events()
            .publish((symbol_short!("refund"), buyer), pledged);
        Ok(pledged)
    }

    pub fn pledged_of(env: Env, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Pledged(who))
            .unwrap_or(0)
    }

    pub fn sale_state(env: Env) -> (i128, i128, i128, u64, Status) {
        let total: i128 = env
            .storage()
            .instance()
            .get(&DataKey::TotalRaised)
            .unwrap_or(0);
        let soft: i128 = env
            .storage()
            .instance()
            .get(&DataKey::SoftCap)
            .unwrap_or(0);
        let hard: i128 = env
            .storage()
            .instance()
            .get(&DataKey::HardCap)
            .unwrap_or(0);
        let deadline: u64 = env
            .storage()
            .instance()
            .get(&DataKey::Deadline)
            .unwrap_or(0);
        let status: Status = env
            .storage()
            .instance()
            .get(&DataKey::Status)
            .unwrap_or(Status::Active);
        (total, soft, hard, deadline, status)
    }

    pub fn token_contract(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
