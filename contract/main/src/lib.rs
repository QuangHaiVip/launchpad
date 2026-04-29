#![no_std]

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    symbol_short, token, Address, Env,
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
    CampaignNotFound = 10,
    InvalidParams = 11,
    NotCreator = 12,
    AlreadyWithdrawn = 13,
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
pub struct Campaign {
    pub creator: Address,
    pub price_tokens_per_xlm: i128,
    pub soft_cap: i128,
    pub hard_cap: i128,
    pub deadline: u64,
    pub total_raised: i128,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Token,
    Native,
    NextId,
    Campaign(u64),
    Pledged(u64, Address),
    Claimed(u64, Address),
    Withdrawn(u64),
}

#[contractclient(name = "TokenClient")]
pub trait TokenInterface {
    fn mint(env: Env, to: Address, amount: i128);
}

#[contract]
pub struct Launchpad;

#[contractimpl]
impl Launchpad {
    pub fn __constructor(env: Env, token: Address, native: Address) {
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Native, &native);
        env.storage().instance().set(&DataKey::NextId, &0_u64);
    }

    /// Open a new fundraising campaign. Anyone can call but they must auth as
    /// `creator`; the creator is recorded as metadata (no special runtime auth).
    /// Returns the new campaign id.
    pub fn create_campaign(
        env: Env,
        creator: Address,
        price_tokens_per_xlm: i128,
        soft_cap: i128,
        hard_cap: i128,
        deadline: u64,
    ) -> Result<u64, Error> {
        creator.require_auth();
        if price_tokens_per_xlm <= 0
            || soft_cap <= 0
            || hard_cap <= 0
            || hard_cap < soft_cap
            || deadline <= env.ledger().timestamp()
        {
            return Err(Error::InvalidParams);
        }

        let id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0);
        let campaign = Campaign {
            creator: creator.clone(),
            price_tokens_per_xlm,
            soft_cap,
            hard_cap,
            deadline,
            total_raised: 0,
            status: Status::Active,
        };
        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .instance()
            .set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("create"), creator),
            (id, soft_cap, hard_cap, deadline),
        );
        Ok(id)
    }

    pub fn pledge(
        env: Env,
        buyer: Address,
        campaign_id: u64,
        amount: i128,
    ) -> Result<(), Error> {
        buyer.require_auth();
        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)?;
        if campaign.status != Status::Active {
            return Err(Error::SaleClosed);
        }
        if env.ledger().timestamp() >= campaign.deadline {
            return Err(Error::SaleClosed);
        }
        if campaign.total_raised + amount > campaign.hard_cap {
            return Err(Error::HardCapExceeded);
        }

        let native_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Native)
            .ok_or(Error::NotInitialized)?;
        let xlm = token::Client::new(&env, &native_addr);
        xlm.transfer(&buyer, &env.current_contract_address(), &amount);

        let prev: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(campaign_id, buyer.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::Pledged(campaign_id, buyer.clone()),
            &(prev + amount),
        );
        campaign.total_raised += amount;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events()
            .publish((symbol_short!("pledge"), buyer), (campaign_id, amount));
        Ok(())
    }

    pub fn finalize(env: Env, campaign_id: u64) -> Result<Status, Error> {
        let mut campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)?;
        if campaign.status != Status::Active {
            return Err(Error::SaleClosed);
        }
        if env.ledger().timestamp() < campaign.deadline {
            return Err(Error::SaleStillOpen);
        }

        campaign.status = if campaign.total_raised >= campaign.soft_cap {
            Status::Successful
        } else {
            Status::Failed
        };
        let new_status = campaign.status;
        let total = campaign.total_raised;
        env.storage()
            .persistent()
            .set(&DataKey::Campaign(campaign_id), &campaign);

        env.events().publish(
            (symbol_short!("finalize"),),
            (campaign_id, total, new_status as u32),
        );
        Ok(new_status)
    }

    pub fn claim(env: Env, buyer: Address, campaign_id: u64) -> Result<i128, Error> {
        buyer.require_auth();
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)?;
        if campaign.status != Status::Successful {
            return Err(Error::SoftCapNotMet);
        }
        let pledged: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(campaign_id, buyer.clone()))
            .ok_or(Error::NoPledge)?;
        if pledged <= 0 {
            return Err(Error::NoPledge);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Claimed(campaign_id, buyer.clone()))
        {
            return Err(Error::AlreadyClaimed);
        }

        let token_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .ok_or(Error::NotInitialized)?;
        let tokens = pledged * campaign.price_tokens_per_xlm / 10_000_000;

        let token = TokenClient::new(&env, &token_addr);
        token.mint(&buyer, &tokens);

        env.storage()
            .persistent()
            .set(&DataKey::Claimed(campaign_id, buyer.clone()), &true);
        env.events()
            .publish((symbol_short!("claim"), buyer), (campaign_id, pledged, tokens));
        Ok(tokens)
    }

    pub fn refund(env: Env, buyer: Address, campaign_id: u64) -> Result<i128, Error> {
        buyer.require_auth();
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)?;
        if campaign.status != Status::Failed {
            return Err(Error::SoftCapMet);
        }
        let pledged: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Pledged(campaign_id, buyer.clone()))
            .ok_or(Error::NoPledge)?;
        if pledged <= 0 {
            return Err(Error::NoPledge);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Pledged(campaign_id, buyer.clone()), &0_i128);

        let native_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Native)
            .ok_or(Error::NotInitialized)?;
        let xlm = token::Client::new(&env, &native_addr);
        xlm.transfer(&env.current_contract_address(), &buyer, &pledged);

        env.events()
            .publish((symbol_short!("refund"), buyer), (campaign_id, pledged));
        Ok(pledged)
    }

    /// After a successful campaign, the creator pulls the raised XLM out.
    /// Idempotent per campaign: a second call returns AlreadyWithdrawn.
    pub fn withdraw(env: Env, creator: Address, campaign_id: u64) -> Result<i128, Error> {
        creator.require_auth();
        let campaign: Campaign = env
            .storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
            .ok_or(Error::CampaignNotFound)?;
        if campaign.creator != creator {
            return Err(Error::NotCreator);
        }
        if campaign.status != Status::Successful {
            return Err(Error::SoftCapNotMet);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Withdrawn(campaign_id))
        {
            return Err(Error::AlreadyWithdrawn);
        }

        let total = campaign.total_raised;
        let native_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Native)
            .ok_or(Error::NotInitialized)?;
        let xlm = token::Client::new(&env, &native_addr);
        xlm.transfer(&env.current_contract_address(), &creator, &total);

        env.storage()
            .persistent()
            .set(&DataKey::Withdrawn(campaign_id), &true);
        env.events().publish(
            (symbol_short!("withdraw"), creator),
            (campaign_id, total),
        );
        Ok(total)
    }

    pub fn pledged_of(env: Env, campaign_id: u64, who: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Pledged(campaign_id, who))
            .unwrap_or(0)
    }

    pub fn campaign(env: Env, campaign_id: u64) -> Option<Campaign> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(campaign_id))
    }

    pub fn was_withdrawn(env: Env, campaign_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Withdrawn(campaign_id))
    }

    pub fn campaign_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextId)
            .unwrap_or(0)
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
